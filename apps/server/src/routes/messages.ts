import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ATTACHMENT_MAX_CHARS,
  feedbackSchema,
  regenerateSchema,
  sendMessageSchema,
  type MessageDTO,
  type MessagePartDTO,
  type StreamEvent,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import type { AuthUser } from '../lib/types.ts';
import { HttpError, badRequest, notFound, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import type { AiMessage, AiToolCall, Effort } from '../services/ai.ts';
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

const MEMORY_TRIGGER = /(hatırla|hatirla|aklında tut|aklinda tut|unutma|remember (that|this|me|my)|keep in mind)/i;

interface GenerationInput {
  chat: ChatRow;
  user: AuthUser;
  /** Yeni oluşturulan kullanıcı mesajı (yeniden üretmede null). */
  userMessage: MessageDTO | null;
  assistantId: string;
  /** Modele gidecek geçmiş (son eleman kullanıcı mesajı). */
  history: HistoryItem[];
  effort: Effort;
  isFirstExchange: boolean;
  userText: string;
}

export function messageRoutes(ctx: AppContext, guard: Guard) {
  const { db, ai, usage, log, tools, config } = ctx;

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
    });
  }

  async function assertNotBusy(chatId: string) {
    const r = await db.query(
      `select 1 from messages where chat_id = $1 and status = 'streaming' and created_at > now() - interval '3 minutes' limit 1`,
      [chatId],
    );
    if (r.rowCount) throw new HttpError(409, 'conflict', 'Bu sohbette bir yanıt zaten üretiliyor.');
  }

  /** SSE yanıtını açar ve olay gönderici döner. */
  function openStream(req: FastifyRequest, reply: FastifyReply) {
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
    const ac = new AbortController();
    let closed = false;
    raw.on('close', () => {
      closed = true;
      if (!raw.writableFinished) ac.abort();
    });
    const ping = setInterval(() => {
      if (!closed) raw.write(': ping\n\n');
    }, 15_000);
    return {
      signal: ac.signal,
      get closed() {
        return closed;
      },
      send(event: StreamEvent) {
        if (!closed) raw.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      end() {
        clearInterval(ping);
        if (!closed) raw.end();
      },
    };
  }

  async function generate(req: FastifyRequest, reply: FastifyReply, g: GenerationInput) {
    const stream = openStream(req, reply);
    try {
      await runGeneration(req, stream, g);
    } catch (err) {
      log.error({ err }, 'akış beklenmedik şekilde sonlandı');
      stream.send({ type: 'error', code: 'internal', message: 'Beklenmeyen bir hata oluştu.' });
    } finally {
      stream.end();
    }
  }

  async function runGeneration(req: FastifyRequest, stream: ReturnType<typeof openStream>, g: GenerationInput) {
    const { chat, user } = g;
    const system = await loadPromptContext(user, chat.persona_id).catch(() => '');
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
    let status: MessageDTO['status'] = 'complete';
    let errorMessage: { code: HttpError['code']; message: string } | null = null;
    const parts: MessagePartDTO[] = [];

    const defs = toolsFor(user);
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
          effort: g.effort,
          tools: defs.length && !lastStep ? specs : undefined,
          patient: step > 0,
        })) {
          if (chunk.type === 'reasoning') {
            if (!reasoningStart) reasoningStart = Date.now();
            reasoning += chunk.text;
            stream.send({ type: 'reasoning', delta: chunk.text });
          } else if (chunk.type === 'content') {
            if (reasoningStart && reasoningMs === null) reasoningMs = Date.now() - reasoningStart;
            content += chunk.text;
            stepText += chunk.text;
            const last = parts[parts.length - 1];
            if (last?.type === 'text') last.text += chunk.text;
            else parts.push({ type: 'text', text: chunk.text });
            stream.send({ type: 'delta', delta: chunk.text });
          } else {
            calls = chunk.calls;
          }
        }
        if (reasoningStart && reasoningMs === null) reasoningMs = Date.now() - reasoningStart;
        if (!calls.length) break;

        // Modelin araç isteğini konuşmaya ekle, sonra çalıştır.
        messages.push({ role: 'assistant', content: stepText, tool_calls: calls });
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
          stream.send({ type: 'tool_end', id: part.id, status: run.status, output: run.output, summary: run.summary, ms: run.ms });
          messages.push({ role: 'tool', tool_call_id: call.id, content: run.output });
        }
        for (const extra of calls.slice(4)) {
          messages.push({ role: 'tool', tool_call_id: extra.id, content: 'Hata: Aynı turda en fazla 4 araç çağrılabilir.' });
        }
        await saveParts();
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
    // Yarıda kalan araçlar "çalışıyor" görünmesin.
    for (const p of parts) {
      if (p.type === 'tool' && p.status === 'running') {
        p.status = 'error';
        p.summary = 'Durduruldu';
        p.output = p.output ?? 'İptal edildi.';
      }
    }

    // Hiç çıktı üretilemediyse hakkı geri ver.
    if (status === 'error' && !content) await usage.refund(user.id, user.isGuest ? req.ip : null).catch(() => {});

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
            const raw = (await ai.complete({ messages: memoryPrompt(g.userText), effort: 'low', temperature: 0 })).trim();
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

        await assertNotBusy(chat.id);
        await usage.consume(user.id, user.tier, user.isGuest ? req.ip : null);

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
          await usage.refund(user.id, user.isGuest ? req.ip : null).catch(() => {});
          throw err;
        }

        const path = await getPath(db, userRow.id);
        const history = path.map((m) => ({
          role: m.role,
          content: m.role === 'user' ? renderUserContent(m.content, m.attachments ?? []) : m.content,
          parts: m.role === 'assistant' ? m.parts : undefined,
        }));
        await generate(req, reply, {
          chat,
          user,
          userMessage: toMessageDTO(userRow),
          assistantId,
          history,
          effort: body.effort ?? 'low',
          isFirstExchange,
          userText: body.content,
        });
      },
    );

    // --- Yeniden üret (SSE) ---
    app.post<{ Params: { id: string } }>(
      '/chats/:id/regenerate',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = req.user!;
        const body = parse(regenerateSchema, req.body);
        const chat = await getOwnedChat(db, req.params.id, user.id);
        if (!chat) throw notFound('Sohbet bulunamadı.');
        const target = await db.query<{ id: string; role: string; parent_id: string | null }>(
          'select id, role, parent_id from messages where id = $1 and chat_id = $2',
          [body.messageId, chat.id],
        );
        const t = target.rows[0];
        if (!t || t.role !== 'assistant' || !t.parent_id) throw badRequest('Bu mesaj yeniden üretilemez.');

        await assertNotBusy(chat.id);
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
        await generate(req, reply, {
          chat,
          user,
          userMessage: null,
          assistantId,
          history,
          effort: body.effort ?? 'low',
          isFirstExchange: false,
          userText: lastUser?.content ?? '',
        });
      },
    );

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
