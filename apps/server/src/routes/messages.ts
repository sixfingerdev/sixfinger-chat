import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ATTACHMENT_MAX_CHARS,
  DEFAULT_THINKING_LEVEL,
  feedbackSchema,
  legacyModeFromEffort,
  regenerateSchema,
  sendMessageSchema,
  type ChatMode,
  type CodeQueueItemDTO,
  type MessageDTO,
  type MessagePartDTO,
  type StreamEvent,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import type { AuthUser } from '../lib/types.ts';
import type { Run } from '../services/runs.ts';
import { runCodeGeneration, type CodeRunInput } from '../services/code-run.ts';
import { HttpError, badRequest, conflict, forbidden, notFound, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import type { AiMessage, AiToolCall, Effort } from '../services/ai.ts';
import { isMcpToolName, type McpApprovalMeta } from '@sixfinger/shared';
import { connectorsSection } from '../services/mcp/prompt.ts';
import { runToolCall, toolSpecs } from '../services/tools/index.ts';
import {
  MESSAGE_COLUMNS,
  getOwnedChat,
  getPath,
  toMessageDTO,
  type ChatRow,
  type MessageRow,
} from '../services/chats.ts';
import { addMemory, listMemories } from '../services/memories.ts';
import {
  MODEL_ID,
  buildSystemPrompt,
  cleanTitle,
  fallbackTitle,
  fitHistory,
  memoryPrompt,
  type HistoryItem,
  renderUserContent,
  titlePrompt,
} from '../services/prompt.ts';
import { findUserById, settingsOf } from '../services/users.ts';

/** İstekten çalışma modunu ve düşünme düzeyini çıkarır; `mode` göndermeyen eski istemcilerde `effort` modu belirler. */
function chosenMode(body: { mode?: ChatMode; effort?: Effort }): { mode: ChatMode; effort: Effort } {
  if (body.mode) return { mode: body.mode, effort: body.effort ?? DEFAULT_THINKING_LEVEL };
  return { mode: legacyModeFromEffort(body.effort), effort: DEFAULT_THINKING_LEVEL };
}

/** Kesilen yanıtta kapanmamış <artifact>/<widget> etiketlerini kapatır (önizleme sonsuza dek "yazılıyor" kalmasın). */
export function closeOpenTags(text: string): string {
  let out = '';
  for (const tag of ['artifact', 'widget']) {
    const opened = (text.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
    const closed = (text.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (opened > closed) out += `\n</${tag}>`;
  }
  return out;
}

const truncationNote = (locale: string) =>
  locale === 'tr'
    ? '\n\n*Yanıt uzunluk sınırına ulaştığı için burada kesildi. “Devam et” yazarak sürdürebilirsin.*'
    : '\n\n*The reply was cut off at the length limit. Type “continue” to carry on.*';

/**
 * Mesajda kalıcı bir kişisel bilgi olabileceğine dair ipuçları (ad, yaş, yer, meslek, tercih, "bundan sonra"…).
 * Yalnızca ön süzgeçtir: kaydedilip kaydedilmeyeceğine model karar verir (`memoryPrompt`), böylece her mesaja ek model çağrısı yapılmaz.
 */
export const MEMORY_TRIGGER = new RegExp(
  [
    'hatırla|hatirla|aklında tut|aklinda tut|unutma|not al',
    'adım|adim|ismim|ismimi|benim ad|bana .{1,30} (de|hitap)|hitap',
    'yaşındayım|yasindayim|yaşıyorum|yasiyorum|oturuyorum|memleketim|doğum günüm|dogum gunum',
    'çalışıyorum|calisiyorum|mesleğim|meslegim|okuyorum|öğrenciyim|ogrenciyim|işim|isim ',
    'seviyorum|sevmiyorum|sevmem|severim|tercih|favori|alerjim|vejetaryen|vegan',
    'bundan sonra|her zaman|asla|hep ',
    "remember (that|this|me|my)|keep in mind|my name|call me|i am \\d|i'm \\d|i live|i work|i study|i (really )?(like|love|hate|prefer)|my favou?rite|from now on|always|never",
  ].join('|'),
  'i',
);

interface GenerationInput {
  chat: ChatRow;
  user: AuthUser;
  /** Yeni oluşturulan kullanıcı mesajı (yeniden üretmede null). */
  userMessage: MessageDTO | null;
  assistantId: string;
  /** Modele gidecek geçmiş (son eleman kullanıcı mesajı). */
  history: HistoryItem[];
  mode: ChatMode;
  effort: Effort;
  isFirstExchange: boolean;
  userText: string;
}

export function messageRoutes(ctx: AppContext, guard: Guard) {
  const { db, ai, usage, log, tools, config, runs, code } = ctx;

  /** Bu kullanıcının bu yanıtta kullanabileceği araçlar. */
  const toolsFor = (user: AuthUser) => (config.TOOLS_ENABLED ? tools.forUser(user) : []);

  async function loadPromptContext(user: AuthUser, personaId: string) {
    const row = await findUserById(db, user.id);
    const settings = settingsOf(row!);
    const features = user.limits.features;
    const memories =
      features.memory && settings.memoryEnabled ? (await listMemories(db, user.id)).map((m) => m.content) : [];
    return buildSystemPrompt({
      locale: user.locale,
      personaId: features.personas ? personaId : 'default',
      settings: features.customInstructions ? settings : { ...settings, customName: '', about: '', instructions: '' },
      memories,
      displayName: user.isGuest ? '' : row!.display_name,
      tools: { web: toolsFor(user).some((t) => t.name === 'web_search'), sandbox: toolsFor(user).some((t) => t.name === 'bash') },
      memory: features.memory ? (settings.memoryEnabled ? 'on' : 'off') : 'locked',
    });
  }

  async function assertCanStart(chatId: string, user: AuthUser) {
    if (runs.forChat(chatId)) throw new HttpError(409, 'conflict', 'Bu sohbette bir yanıt zaten üretiliyor.');
    // Kullanıcı başına eşzamanlı üretim sınırı: arka planda sürenler de sayılır.
    const limit = user.isGuest ? 2 : 4;
    if (runs.countForUser(user.id) >= limit) {
      throw new HttpError(409, 'conflict', 'Aynı anda çok fazla yanıt üretiliyor. Biri bitince tekrar dene.');
    }
  }

  /**
   * SSE yanıtını açıp bir üretime bağlar. Bağlantı kapanırsa yalnızca bu dinleyici ayrılır; üretim sürer
   * (durdurmak için ayrı bir uç var). `withSnapshot` ise önce o ana kadarki mesaj gönderilir.
   */
  function attach(reply: FastifyReply, run: Run, withSnapshot: boolean) {
    reply.hijack();
    const raw = reply.raw;
    const inherited: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) inherited[k] = v;
    raw.writeHead(200, {
      ...inherited,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(': sixfinger\n\n');
    let closed = false;
    const ping = setInterval(() => {
      if (!closed) raw.write(': ping\n\n');
    }, 15_000);
    const unsubscribe = run.subscribe(
      {
        send: (event) => {
          if (!closed) raw.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        close: () => {
          clearInterval(ping);
          if (!closed) raw.end();
        },
      },
      withSnapshot,
    );
    raw.on('close', () => {
      closed = true;
      clearInterval(ping);
      unsubscribe();
    });
  }

  interface TurnBody {
    content: string;
    attachments?: Array<{ name: string; mime: string; text: string }>;
    parentId?: string | null;
  }
  interface BegunTurn {
    userRow: MessageRow;
    assistantId: string;
    history: HistoryItem[];
    isFirstExchange: boolean;
  }

  /** Mesaj uzunluğu ve ek sınırları (istek ve kuyruğa ekleme ortak). */
  function assertTurnBody(user: AuthUser, body: TurnBody) {
    if (body.content.length > user.limits.maxMessageChars) {
      throw badRequest(`Mesaj en fazla ${user.limits.maxMessageChars} karakter olabilir.`);
    }
    const attachments = body.attachments ?? [];
    if (attachments.length) {
      if (!user.limits.features.attachments) throw tierRestricted('Dosya eklemek için e-postanı doğrulamış bir hesap gerekir.');
      if (attachments.length > user.limits.maxAttachments) {
        throw badRequest(`En fazla ${user.limits.maxAttachments} dosya eklenebilir.`);
      }
      if (attachments.some((a) => a.text.length > ATTACHMENT_MAX_CHARS)) throw badRequest('Dosya çok büyük.');
    }
  }

  /** Kullanıcı mesajını ve boş asistan yanıtını yazar, modele gidecek geçmişi hazırlar (doğrulamalar dahil). Hem istek hem sunucu kuyruğu kullanır. */
  async function beginTurn(chat: ChatRow, user: AuthUser, body: TurnBody, ip: string | null): Promise<BegunTurn> {
    const isCode = chat.kind === 'code';
    assertTurnBody(user, body);
    const attachments = body.attachments ?? [];

    // Yeni mesajın ebeveyni: açıkça verilmişse o, yoksa sohbetin ucu.
    const parentId = body.parentId === undefined ? chat.leaf_id : body.parentId;
    if (parentId) {
      const p = await db.query<{ role: string }>('select role from messages where id = $1 and chat_id = $2', [
        parentId,
        chat.id,
      ]);
      if (!p.rows[0]) throw badRequest('Üst mesaj bulunamadı.');
      if (p.rows[0].role !== 'assistant') throw badRequest('Bir kullanıcı mesajının altına mesaj eklenemez.');
    }

    await assertCanStart(chat.id, user);
    // Code kendi kredisini kullanır; sohbet günlük mesaj hakkından düşmez.
    if (!isCode) await usage.consume(user.id, user.tier, user.isGuest ? ip : null);

    let userRow: MessageRow, assistantId: string;
    let isFirstExchange = false;
    try {
      const count = await db.query<{ n: number }>('select count(*)::int as n from messages where chat_id = $1', [chat.id]);
      isFirstExchange = (count.rows[0]?.n ?? 0) === 0;
      const u = await db.query<MessageRow>(
        `insert into messages (chat_id, parent_id, role, content, attachments)
         values ($1, $2, 'user', $3, $4) returning ${MESSAGE_COLUMNS}`,
        [chat.id, parentId, body.content, JSON.stringify(attachments)],
      );
      userRow = u.rows[0]!;
      const a = await db.query<{ id: string }>(
        `insert into messages (chat_id, parent_id, role, status, model)
         values ($1, $2, 'assistant', 'streaming', $3) returning id`,
        [chat.id, userRow.id, MODEL_ID],
      );
      assistantId = a.rows[0]!.id;
      await db.query(`update chats set leaf_id = $2, last_message_at = now(), updated_at = now() where id = $1`, [
        chat.id,
        assistantId,
      ]);
    } catch (err) {
      if (!isCode) await usage.refund(user.id, user.isGuest ? ip : null).catch(() => {});
      throw err;
    }

    const path = await getPath(db, userRow.id);
    const history = path.map((m) => ({
      role: m.role,
      content: m.role === 'user' ? renderUserContent(m.content, m.attachments ?? []) : m.content,
      parts: m.role === 'assistant' ? m.parts : undefined,
    }));
    return { userRow, assistantId, history, isFirstExchange };
  }

  /** Üretimi başlatır, istek sahibini ona bağlar ve beklemeden döner; üretim arka planda sürer. */
  function generate(req: FastifyRequest, reply: FastifyReply, g: GenerationInput) {
    const run = runs.start(g.chat.id, g.user.id, g.assistantId);
    attach(reply, run, false);
    const ip = req.ip;
    // Tek bir yanıt için mutlak üst süre: takılı kalan bir üretim sonsuza dek yer tutmasın.
    const cap = setTimeout(() => run.stop(), config.AI_TOTAL_TIMEOUT_MS + 60_000);
    void (async () => {
      try {
        await runGeneration(ip, run, g);
      } catch (err) {
        log.error({ err }, 'akış beklenmedik şekilde sonlandı');
        run.emit({ type: 'error', code: 'internal', message: 'Beklenmeyen bir hata oluştu.' });
        await db.query(`update messages set status = 'error' where id = $1 and status = 'streaming'`, [g.assistantId]).catch(() => {});
      } finally {
        clearTimeout(cap);
        run.finish();
        runs.remove(run);
      }
    })();
  }

  /** Code oturumunda üretimi başlatır (ajan döngüsü); arka planda sürer, istemci kopsa da bitmez. */
  function generateCode(reply: FastifyReply | null, g: CodeRunInput) {
    const run = runs.start(g.chat.id, g.user.id, g.assistantId);
    if (reply) attach(reply, run, false);
    // Code çalıştırmasında süre ya da adım sınırı yoktur: frenler döngü kırıcı, kredi, bağlam doluluğu ve kullanıcının Durdur'udur.
    void (async () => {
      try {
        await runCodeGeneration({ db, ai, tools, sandbox: ctx.codeSandbox, code, queue: ctx.codeQueue, config, log, git: ctx.codeGit, skills: ctx.skills, mcp: ctx.mcp }, run, g);
      } catch (err) {
        log.error({ err }, 'Code üretimi beklenmedik şekilde sonlandı');
        run.emit({ type: 'error', code: 'internal', message: 'Beklenmeyen bir hata oluştu.' });
        await db.query(`update messages set status = 'error' where id = $1 and status = 'streaming'`, [g.assistantId]).catch(() => {});
        await code.setSessionStatus(g.chat.id, 'error').catch(() => {});
      } finally {
        run.finish();
        runs.remove(run);
        void continueQueue(g.chat.id, g.user, g.assistantId);
      }
    })();
  }

  // --- Sunucu tarafı mesaj kuyruğu (Code) ---
  const QUEUE_MAX = 20;
  const draining = new Set<string>();

  interface QueueRow {
    id: string;
    content: string;
    plan_mode: boolean;
    mode: string;
    attachments: Array<{ name: string; mime: string; text: string }>;
    created_at: Date;
  }
  const queueDto = (r: QueueRow): CodeQueueItemDTO => ({ id: r.id, text: r.content, plan: r.plan_mode, attachments: (r.attachments ?? []).map((a) => a.name) });
  const listQueue = async (chatId: string) =>
    (await db.query<QueueRow>('select id, content, plan_mode, mode, attachments, created_at from code_queue where chat_id = $1 order by created_at, id', [chatId])).rows.map(queueDto);

  /** Tur normal bitti ya da kullanıcı durdurdu: sıradaki mesajı sunucu kendisi başlatır (istemci açık olmasa da). Hata ile biten turdan sonra beklemez. */
  async function continueQueue(chatId: string, user: AuthUser, assistantId: string) {
    try {
      const st = await db.query<{ status: string }>('select status from messages where id = $1', [assistantId]);
      if (st.rows[0]?.status === 'complete' || st.rows[0]?.status === 'stopped') await drainCodeQueue(chatId, user);
    } catch (err) {
      log.warn({ err }, 'Code kuyruğu devam ettirilemedi');
    }
  }

  /** Kuyruğun başındaki mesajı başlatır. Başlattıysa true. Şu an çalışma varsa ya da başlatılamazsa mesaj sırada kalır. */
  async function drainCodeQueue(chatId: string, user: AuthUser): Promise<boolean> {
    if (draining.has(chatId) || runs.forChat(chatId) || !code.isAllowed(user)) return false;
    draining.add(chatId);
    try {
      const chat = await getOwnedChat(db, chatId, user.id);
      if (!chat || chat.kind !== 'code') return false;
      const claimed = await db.query<QueueRow>(
        `delete from code_queue where id = (select id from code_queue where chat_id = $1 order by created_at, id limit 1 for update skip locked)
         returning id, content, plan_mode, mode, attachments, created_at`,
        [chatId],
      );
      const item = claimed.rows[0];
      if (!item) return false;
      try {
        const turn = await beginTurn(chat, user, { content: item.content, attachments: item.attachments }, null);
        generateCode(null, {
          chat,
          user,
          userMessage: toMessageDTO(turn.userRow),
          assistantId: turn.assistantId,
          history: turn.history,
          userText: item.content,
          isFirstExchange: turn.isFirstExchange,
          planMode: item.plan_mode,
          codeMode: item.mode === 'fast' ? 'fast' : 'deep',
        });
        return true;
      } catch (err) {
        // Başlatılamadı (ör. eşzamanlı çalışma sınırı): mesajı yerine geri koy, kaybolmasın.
        log.warn({ err }, 'sıradaki Code mesajı başlatılamadı, kuyruğa geri konuldu');
        await db
          .query('insert into code_queue (id, chat_id, user_id, content, plan_mode, mode, attachments, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
            item.id, chatId, user.id, item.content, item.plan_mode, item.mode, JSON.stringify(item.attachments ?? []), item.created_at,
          ])
          .catch(() => {});
        return false;
      }
    } finally {
      draining.delete(chatId);
    }
  }

  async function runGeneration(ip: string, run: Run, g: GenerationInput) {
    const { chat, user } = g;
    // Eski kodla uyum: `stream` üretimin olay gönderici ve iptal sinyali görünümüdür.
    const stream = { signal: run.signal, send: (e: StreamEvent) => run.emit(e) };
    // Bağlayıcılar (MCP): araç listesi veritabanı önbelleğinden gelir; misafir kullanamaz.
    const mcpSet = user.isGuest ? null : await ctx.mcp.toolsFor(user.id, 'chat').catch(() => null);
    const connectors = mcpSet ? connectorsSection(mcpSet) : '';
    const system = ((await loadPromptContext(user, chat.persona_id).catch(() => '')) + (connectors ? `\n\n${connectors}` : '')).trim();
    const assistantRow = await db.query<MessageRow>(`select ${MESSAGE_COLUMNS} from messages where id = $1`, [g.assistantId]);
    stream.send({ type: 'start', userMessage: g.userMessage, assistantMessage: toMessageDTO(assistantRow.rows[0]!) });

    const messages: AiMessage[] = [
      { role: 'system', content: system },
      ...fitHistory(g.history, user.limits.contextTokens),
    ];

    let content = '';
    let reasoning = '';
    let reasoningStart = 0;
    let reasoningMs: number | null = null;
    let truncated = false;
    let status: MessageDTO['status'] = 'complete';
    let errorMessage: { code: HttpError['code']; message: string } | null = null;
    const parts: MessagePartDTO[] = [];
    // Son düşünce parçasının süresi: sonraki parça (metin/araç) başlayınca ya da üretim bitince kapanır.
    let partStart = 0;
    const closeReasoning = () => {
      const last = parts[parts.length - 1];
      if (last?.type === 'reasoning' && last.ms === null) last.ms = Date.now() - partStart;
    };

    // Geri dönen istemciye gösterilecek anlık görüntü ve (sunucu çökerse kaybolmasın diye) 2 sn'de bir veritabanına yazım.
    const base = toMessageDTO(assistantRow.rows[0]!);
    run.snapshot = () => ({ ...base, content, reasoning, reasoningMs, status: 'streaming', parts: JSON.parse(JSON.stringify(parts)) });
    let lastPersist = Date.now();
    const persist = () => {
      if (Date.now() - lastPersist < 2_000) return;
      lastPersist = Date.now();
      db.query('update messages set content = $2, reasoning = $3, parts = $4 where id = $1 and status = \'streaming\'', [
        g.assistantId,
        content,
        reasoning,
        JSON.stringify(parts),
      ]).catch(() => {});
    };

    const defs = [...toolsFor(user), ...(mcpSet?.defs ?? [])];
    const specs = toolSpecs(defs);
    // Araç yoksa tek tur; varsa kullanıcı katmanının izin verdiği kadar tur. Son turda araç verilmez:
    // model elindekiyle cevabı yazmak zorunda kalır.
    const maxSteps = defs.length ? Math.max(1, user.limits.maxToolSteps) : 1;
    // Aynı tur içinde aynı çağrıyı (aynı araç + aynı argümanlar) tekrar çalıştırma: modeli döngüden çıkar.
    const seenCalls = new Map<string, string>();
    const saveParts = () =>
      db.query('update messages set parts = $2 where id = $1', [g.assistantId, JSON.stringify(parts)]).catch(() => {});

    try {
      for (let step = 0; step < maxSteps; step++) {
        const lastStep = step === maxSteps - 1;
        let calls: AiToolCall[] = [];
        let stepText = '';
        if (defs.length && lastStep && step > 0) {
          messages.push({
            role: 'user',
            content:
              '[Sistem notu] Araç sınırına ulaşıldı; artık araç çağıramazsın. Elindeki bilgilerle kullanıcıya şimdi cevabı yaz. ' +
              'Bulamadığın bilgiyi tahmin etme, "bulamadım" de ve nerede aranabileceğini söyle.',
          });
        }

        for await (const chunk of ai.stream({
          messages,
          signal: stream.signal,
          mode: g.mode,
          effort: g.effort,
          tools: defs.length && !lastStep ? specs : undefined,
          patient: step > 0,
        })) {
          if (chunk.type === 'reasoning') {
            if (!reasoningStart) reasoningStart = Date.now();
            reasoning += chunk.text;
            // Her tur kendi düşünce parçasını açar: araç sonucundan sonra yeniden düşünürse eskisine eklenmez.
            const lastPart = parts[parts.length - 1];
            if (lastPart?.type === 'reasoning') lastPart.text += chunk.text;
            else {
              parts.push({ type: 'reasoning', text: chunk.text, ms: null });
              partStart = Date.now();
            }
            stream.send({ type: 'reasoning', delta: chunk.text });
            persist();
          } else if (chunk.type === 'content') {
            closeReasoning();
            if (reasoningStart && reasoningMs === null) reasoningMs = Date.now() - reasoningStart;
            content += chunk.text;
            stepText += chunk.text;
            const last = parts[parts.length - 1];
            if (last?.type === 'text') last.text += chunk.text;
            else parts.push({ type: 'text', text: chunk.text });
            stream.send({ type: 'delta', delta: chunk.text });
            persist();
          } else if (chunk.type === 'truncated') {
            truncated = true;
          } else {
            calls = chunk.calls;
          }
        }
        if (reasoningStart && reasoningMs === null) reasoningMs = Date.now() - reasoningStart;
        if (truncated) {
          // Çıktı sınırında kesildi: açık kalmış artifact/widget'ı kapat ve kullanıcıya nasıl sürdüreceğini söyle.
          const tail = closeOpenTags(content) + truncationNote(user.locale);
          content += tail;
          const last = parts[parts.length - 1];
          if (last?.type === 'text') last.text += tail;
          else parts.push({ type: 'text', text: tail });
          stream.send({ type: 'delta', delta: tail });
          break;
        }
        if (!calls.length) break;

        // Modelin araç isteğini konuşmaya ekle, sonra çalıştır.
        messages.push({ role: 'assistant', content: stepText, tool_calls: calls });
        let waitingApproval: McpApprovalMeta | null = null;
        for (const call of calls.slice(0, 4)) {
          let shownArgs: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.function.arguments || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) shownArgs = parsed;
          } catch {
            /* bozuk JSON: sonuçta hata olarak döner */
          }
          const part: Extract<MessagePartDTO, { type: 'tool' }> = {
            type: 'tool',
            id: call.id,
            name: call.function.name,
            args: shownArgs,
            status: 'running',
          };
          closeReasoning();
          parts.push(part);
          stream.send({ type: 'tool_start', id: part.id, name: part.name, args: part.args });
          const key = `${call.function.name}:${JSON.stringify(Object.fromEntries(Object.entries(shownArgs).filter(([k]) => k !== 'max_chars').sort()))}`;
          const earlier = seenCalls.get(key);
          const run = earlier
            ? {
                status: 'done' as const,
                output: `Not: Bu çağrıyı bu yanıtta zaten yaptın; sonuç aynıdır (aşağıda). Tekrar çağırma: farklı bir ifade dene ya da elindekiyle cevabı yaz.\n\n${earlier.slice(0, 1_500)}`,
                summary: 'tekrar',
                ms: 0,
                args: shownArgs,
              }
            : await runToolCall(defs, call, { user, signal: stream.signal, chatId: chat.id });
          if (!earlier && run.status === 'done') seenCalls.set(key, run.output);
          part.status = run.status;
          part.output = run.output;
          part.summary = run.summary;
          part.ms = run.ms;
          // MCP araçlarının meta'sı (onay kartı verisi) istemciye de gider; diğer araçların meta'sı değişmedi.
          const mcpMeta = isMcpToolName(call.function.name) ? run.meta : undefined;
          if (mcpMeta) part.meta = mcpMeta;
          stream.send({ type: 'tool_end', id: part.id, status: run.status, output: run.output, summary: run.summary, ms: run.ms, ...(mcpMeta ? { meta: mcpMeta } : {}) });
          messages.push({ role: 'tool', tool_call_id: call.id, content: run.output });
          if (mcpMeta?.terminal === true && mcpMeta.approval) {
            waitingApproval = mcpMeta.approval as McpApprovalMeta;
            break;
          }
        }
        for (const extra of calls.slice(4)) {
          messages.push({ role: 'tool', tool_call_id: extra.id, content: 'Hata: Aynı turda en fazla 4 araç çağrılabilir.' });
        }
        await saveParts();
        if (waitingApproval) {
          // Onay bekleniyor: tur biter, kullanıcı kartta karar verince yeni mesajla devam eder.
          const note = `${content.trim() ? '\n\n' : ''}*${user.locale === 'tr' ? `${waitingApproval.server} › ${waitingApproval.tool} için onayını bekliyorum.` : `Waiting for your approval: ${waitingApproval.server} › ${waitingApproval.tool}.`}*`;
          closeReasoning();
          content += note;
          const last = parts[parts.length - 1];
          if (last?.type === 'text') last.text += note;
          else parts.push({ type: 'text', text: note });
          stream.send({ type: 'delta', delta: note });
          break;
        }
      }
      if (!content.trim()) {
        status = 'error';
        errorMessage = { code: 'upstream_unavailable', message: 'Model boş yanıt döndürdü. Tekrar dene.' };
      }
    } catch (err) {
      if (stream.signal.aborted || (err as Error)?.name === 'AbortError') {
        status = 'stopped';
      } else {
        status = 'error';
        errorMessage =
          err instanceof HttpError
            ? { code: err.code, message: err.message }
            : { code: 'upstream_unavailable', message: 'Yanıt üretilirken bir hata oluştu.' };
        if (!(err instanceof HttpError)) log.error({ err }, 'üretim hatası');
      }
      if (reasoningStart && reasoningMs === null) reasoningMs = Date.now() - reasoningStart;
    }
    closeReasoning();
    // Yarıda kalan araçlar "çalışıyor" görünmesin.
    for (const p of parts) {
      if (p.type === 'tool' && p.status === 'running') {
        p.status = 'error';
        p.summary = 'Durduruldu';
        p.output = p.output ?? 'İptal edildi.';
      }
    }

    // Hiç çıktı üretilemediyse hakkı geri ver.
    if (status === 'error' && !content) await usage.refund(user.id, user.isGuest ? ip : null).catch(() => {});

    const saved = await db.query<MessageRow>(
      `update messages set content = $2, reasoning = $3, reasoning_ms = $4, status = $5, model = $6, tokens_out = $7, parts = $8
        where id = $1 returning ${MESSAGE_COLUMNS}`,
      [g.assistantId, content, reasoning, reasoningMs, status, MODEL_ID, Math.ceil(content.length / 3.5), JSON.stringify(parts)],
    );
    const assistant = toMessageDTO(saved.rows[0]!);
    await db.query('update chats set updated_at = now() where id = $1', [chat.id]).catch(() => {});

    if (errorMessage) stream.send({ type: 'error', code: errorMessage.code, message: errorMessage.message });
    stream.send({ type: 'usage', usage: await usage.get(user.id, user.tier) });
    stream.send({ type: 'done', assistantMessage: assistant });
    run.settle(); // başlık/hafıza üretilirken kullanıcı yeni mesaj gönderebilir

    // --- Yan işler: başlık ve hafıza (istemci kapandıysa da veritabanına yazılır) ---
    if (status === 'complete') {
      if (g.isFirstExchange && !chat.title_generated) {
        let title = fallbackTitle(g.userText);
        try {
          const raw = await ai.complete({
            messages: titlePrompt(g.userText, content, user.locale),
            effort: 'low',
            temperature: 0.3,
          });
          title = cleanTitle(raw, title);
        } catch (err) {
          log.warn({ err }, 'başlık üretilemedi, yedek başlık kullanılıyor');
        }
        await db.query('update chats set title = $2, title_generated = true where id = $1 and title_generated = false', [
          chat.id,
          title,
        ]);
        stream.send({ type: 'title', title });
      }
      const features = user.limits.features;
      if (features.memory && MEMORY_TRIGGER.test(g.userText)) {
        const row = await findUserById(db, user.id);
        if (row && settingsOf(row).memoryEnabled) {
          try {
            const known = (await listMemories(db, user.id)).map((m) => m.content);
            const raw = (await ai.complete({ messages: memoryPrompt(g.userText, known), effort: 'low', temperature: 0 })).trim();
            if (raw && !/^none\b/i.test(raw)) {
              const memory = await addMemory(db, user.id, raw.replace(/^["'\-\s]+|["'\s]+$/g, ''));
              stream.send({ type: 'memory', memory });
            }
          } catch (err) {
            log.warn({ err }, 'hafıza kaydı eklenemedi');
          }
        }
      }
    }
  }

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);

    // --- Mesaj gönder (SSE) ---
    app.post<{ Params: { id: string } }>(
      '/chats/:id/messages',
      { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = req.user!;
        const body = parse(sendMessageSchema, req.body);
        const chat = await getOwnedChat(db, req.params.id, user.id);
        if (!chat) throw notFound('Sohbet bulunamadı.');
        const isCode = chat.kind === 'code';
        if (isCode) {
          if (!code.isAllowed(user)) throw forbidden('Code için erişimin yok.');
        }

        const turn = await beginTurn(chat, user, body, req.ip);
        const { userRow, assistantId, history, isFirstExchange } = turn;
        if (isCode) {
          return generateCode(reply, { chat, user, userMessage: toMessageDTO(userRow), assistantId, history, userText: body.content, isFirstExchange, planMode: body.planMode === true, codeMode: body.mode === 'fast' ? 'fast' : 'deep' });
        }
        generate(req, reply, {
          chat,
          user,
          userMessage: toMessageDTO(userRow),
          assistantId,
          history,
          ...chosenMode(body),
          isFirstExchange,
          userText: body.content,
        });
      },
    );

    // --- Code: sunucu tarafı mesaj kuyruğu ---
    const codeChatOf = async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const chat = await getOwnedChat(db, req.params.id, req.user!.id);
      if (!chat || chat.kind !== 'code') throw notFound('Code oturumu bulunamadı.');
      if (!code.isAllowed(req.user!)) throw forbidden('Code için erişimin yok.');
      return chat;
    };

    app.get<{ Params: { id: string } }>('/chats/:id/queue', async (req) => {
      const chat = await codeChatOf(req);
      return { queue: await listQueue(chat.id) };
    });

    app.post<{ Params: { id: string } }>(
      '/chats/:id/queue',
      { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = req.user!;
        const body = parse(sendMessageSchema, req.body);
        const chat = await codeChatOf(req);
        assertTurnBody(user, body);
        const n = await db.query<{ n: number }>('select count(*)::int as n from code_queue where chat_id = $1', [chat.id]);
        if ((n.rows[0]?.n ?? 0) >= QUEUE_MAX) throw badRequest(`Sırada en fazla ${QUEUE_MAX} mesaj bekleyebilir.`);
        await db.query('insert into code_queue (chat_id, user_id, content, plan_mode, mode, attachments) values ($1, $2, $3, $4, $5, $6)', [
          chat.id,
          user.id,
          body.content,
          body.planMode === true,
          body.mode === 'fast' ? 'fast' : 'deep',
          JSON.stringify(body.attachments ?? []),
        ]);
        // O sırada çalışma yoksa (tur az önce bitti) sıradaki hemen başlar.
        const started = runs.forChat(chat.id) ? false : await drainCodeQueue(chat.id, user);
        return reply.code(201).send({ queue: await listQueue(chat.id), started });
      },
    );

    app.delete<{ Params: { id: string; qid: string } }>('/chats/:id/queue/:qid', async (req, reply) => {
      const chat = await codeChatOf(req);
      await db.query('delete from code_queue where id = $1 and chat_id = $2', [req.params.qid, chat.id]).catch(() => {});
      return reply.code(204).send();
    });

    // --- Yeniden üret (SSE) ---
    app.post<{ Params: { id: string } }>(
      '/chats/:id/regenerate',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = req.user!;
        const body = parse(regenerateSchema, req.body);
        const chat = await getOwnedChat(db, req.params.id, user.id);
        if (!chat) throw notFound('Sohbet bulunamadı.');
        if (chat.kind === 'code') throw conflict('Code oturumlarında çalıştırma henüz hazır değil.');
        const target = await db.query<{ id: string; role: string; parent_id: string | null }>(
          'select id, role, parent_id from messages where id = $1 and chat_id = $2',
          [body.messageId, chat.id],
        );
        const t = target.rows[0];
        if (!t || t.role !== 'assistant' || !t.parent_id) throw badRequest('Bu mesaj yeniden üretilemez.');

        await assertCanStart(chat.id, user);
        await usage.consume(user.id, user.tier, user.isGuest ? req.ip : null);

        let assistantId: string;
        try {
          const a = await db.query<{ id: string }>(
            `insert into messages (chat_id, parent_id, role, status, model)
             values ($1, $2, 'assistant', 'streaming', $3) returning id`,
            [chat.id, t.parent_id, MODEL_ID],
          );
          assistantId = a.rows[0]!.id;
          await db.query('update chats set leaf_id = $2, updated_at = now() where id = $1', [chat.id, assistantId]);
        } catch (err) {
          await usage.refund(user.id, user.isGuest ? req.ip : null).catch(() => {});
          throw err;
        }

        const path = await getPath(db, t.parent_id);
        const history = path.map((m) => ({
          role: m.role,
          content: m.role === 'user' ? renderUserContent(m.content, m.attachments ?? []) : m.content,
          parts: m.role === 'assistant' ? m.parts : undefined,
        }));
        const lastUser = [...path].reverse().find((m) => m.role === 'user');
        generate(req, reply, {
          chat,
          user,
          userMessage: null,
          assistantId,
          history,
          ...chosenMode(body),
          isFirstExchange: false,
          userText: lastUser?.content ?? '',
        });
      },
    );

    // --- Üretimi durdur ---
    // Bağlantı kopması üretimi durdurmaz (uygulama kapanınca sunucuda sürer); durdurmak için bu uç çağrılır.
    app.post<{ Params: { id: string } }>('/chats/:id/stop', async (req) => {
      const chat = await getOwnedChat(db, req.params.id, req.user!.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      const run = runs.forChat(chat.id);
      run?.stop();
      return { stopped: Boolean(run) };
    });

    // --- Süren üretimi izle (uygulama yeniden açılınca): önce anlık görüntü, sonra canlı olaylar (SSE) ---
    app.get<{ Params: { id: string } }>('/chats/:id/stream', async (req, reply) => {
      const chat = await getOwnedChat(db, req.params.id, req.user!.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      const run = runs.forChat(chat.id);
      if (!run || !run.snapshot) return reply.code(204).send();
      attach(reply, run, true);
    });

    // --- Geri bildirim ---
    app.put<{ Params: { id: string } }>('/messages/:id/feedback', async (req) => {
      const { value } = parse(feedbackSchema, req.body);
      const r = await db.query<MessageRow>(
        `update messages m set feedback = $3
           from chats c
          where m.id = $1 and m.chat_id = c.id and c.user_id = $2 and m.role = 'assistant'
          returning m.id, m.chat_id, m.parent_id, m.role, m.content, m.reasoning, m.reasoning_ms, m.status,
                    m.model, m.attachments, m.parts, m.feedback, m.created_at`,
        [req.params.id, req.user!.id, value],
      );
      if (!r.rows[0]) throw notFound('Mesaj bulunamadı.');
      return { message: toMessageDTO(r.rows[0]) };
    });
  };
}
