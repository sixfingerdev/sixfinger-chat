import { create } from 'zustand';
import type { ChatDTO, MessageDTO, MessagePartDTO, StreamEvent } from '@sixfinger/shared';
import { ApiError, api, streamGet, streamRequest } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { translate } from '../lib/i18n/index.ts';
import { kv } from '../lib/storage.ts';
import type { PendingAttachment } from '../lib/types.ts';
import { activePath, deepestLeaf, indexMessages } from '../lib/tree.ts';
import { useCode } from './code.ts';
import { useUi } from './ui.ts';

export interface ChatDetail {
  chat: ChatDTO;
  messages: MessageDTO[];
}

export interface Generating {
  chatId: string;
  assistantId: string;
  abort: AbortController;
  /** Ön plana dönünce bağlantıyı bilerek kesip yeniden izlemeye başlamak için. */
  reconnect?: boolean;
}

type EventSource = (onEvent: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Code: süren turun evresi (durum çubuğu ve mesaj altı satır). */
export interface CodeRun {
  phase: 'queued' | 'preparing' | 'working' | 'committing' | 'publishing';
  position?: number;
  /** Turun başlangıcı (istemci saatiyle): sunucunun bildirdiği geçen süreden hesaplanır, yeniden açılışta sıfırlanmaz. */
  startedAt?: number;
}

interface ChatsState {
  chats: ChatDTO[];
  archived: ChatDTO[] | null;
  chatsLoaded: boolean;
  detail: Record<string, ChatDetail>;
  activeId: string | null;
  loadingId: string | null;
  loadError: 'notfound' | 'error' | null;
  /** Sohbet kimliği → o sohbette süren üretim. Her sohbet bağımsızdır: birinde üretim sürerken diğerine mesaj gönderilebilir. */
  generating: Record<string, Generating>;
  /** Code: sohbet kimliği → çalışmanın evresi (sırada / hazırlanıyor / çalışıyor / commit). Üretim bitince silinir. */
  codeRun: Record<string, CodeRun>;
  draftPersona: string | null;

  reset: () => void;
  loadChats: () => Promise<void>;
  loadArchived: () => Promise<void>;
  openChat: (id: string, silent?: boolean) => Promise<void>;
  newChat: () => void;
  setDraftPersona: (id: string | null) => void;

  send: (p: {
    content: string;
    attachments?: PendingAttachment[];
    chatId?: string | null;
    /** Düzenleme için: yeni mesajın bağlanacağı üst mesaj (null = kök). */
    parentId?: string | null;
    onChatCreated?: (id: string) => void;
    /** Code: plan modu (ajan değişiklik yapmaz, plan sunar). */
    planMode?: boolean;
  }) => Promise<void>;
  regenerate: (chatId: string, messageId: string) => Promise<void>;
  stop: (chatId: string) => void;
  /** Süren (sunucuda arka planda devam eden) bir üretimi yeniden izler; yoksa son durumu yükler. */
  follow: (chatId: string) => Promise<void>;
  /** Uygulama ön plana gelince / ağ dönünce: açık sohbeti sunucuyla eşitler ve akışı yeniden bağlar. */
  refreshActive: () => void;
  /** Verilen sohbeti (açık olmasa da) sunucuyla eşitler ve süren üretimi yeniden izler. */
  refresh: (id: string) => void;
  switchVersion: (chatId: string, messageId: string) => void;

  renameChat: (id: string, title: string) => Promise<void>;
  pinChat: (id: string, pinned: boolean) => Promise<void>;
  archiveChat: (id: string, archived: boolean) => Promise<void>;
  deleteChat: (id: string) => Promise<boolean>;
  setPersona: (id: string, personaId: string) => Promise<void>;
  setFeedback: (chatId: string, messageId: string, value: 1 | -1 | null) => Promise<void>;
}

/** Akan metni, son parça metinse ona ekler; değilse (araç çağrısından sonra) yeni metin parçası açar. */
function appendText(parts: MessagePartDTO[], text: string): MessagePartDTO[] {
  const last = parts[parts.length - 1];
  if (last?.type === 'text') return [...parts.slice(0, -1), { type: 'text', text: last.text + text }];
  return [...parts, { type: 'text', text }];
}

/** Akan düşünceyi, son parça düşünceyse ona ekler; değilse (araç ya da metinden sonra) yeni düşünce parçası açar. */
function appendReasoning(parts: MessagePartDTO[], text: string): MessagePartDTO[] {
  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning') return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  return [...parts, { type: 'reasoning', text, ms: null }];
}

/** Son düşünce parçasının süresini yazar (sonraki parça başlayınca). */
function closeReasoning(parts: MessagePartDTO[], ms: number): MessagePartDTO[] {
  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning' && last.ms === null) return [...parts.slice(0, -1), { ...last, ms }];
  return parts;
}

const sortChats = (list: ChatDTO[]) =>
  [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
  });

const upsert = (list: ChatDTO[], chat: ChatDTO) => sortChats([chat, ...list.filter((c) => c.id !== chat.id)]);

let tmpSeq = 0;
const tmpId = (p: string) => `tmp-${p}-${++tmpSeq}`;

function blankMessage(over: Partial<MessageDTO> & Pick<MessageDTO, 'id' | 'chatId' | 'role'>): MessageDTO {
  return {
    parentId: null,
    content: '',
    reasoning: '',
    status: 'complete',
    model: null,
    attachments: [],
    feedback: null,
    reasoningMs: null,
    parts: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

export const useChats = create<ChatsState>((set, get) => {
  const patchDetail = (chatId: string, fn: (d: ChatDetail) => ChatDetail) => {
    const d = get().detail[chatId];
    if (d) set({ detail: { ...get().detail, [chatId]: fn(d) } });
  };
  const patchMessage = (chatId: string, id: string, fn: (m: MessageDTO) => MessageDTO) =>
    patchDetail(chatId, (d) => ({ ...d, messages: d.messages.map((m) => (m.id === id ? fn(m) : m)) }));
  const patchChat = (chat: ChatDTO) => {
    set({ chats: get().chats.some((c) => c.id === chat.id) ? sortChats(get().chats.map((c) => (c.id === chat.id ? chat : c))) : get().chats });
    patchDetail(chat.id, (d) => ({ ...d, chat }));
  };

  /** Yeniden açılışta doğru ekrana dönmek için Code oturumları `code:` önekiyle işaretlenir. */
  const pendingKey = (chatId: string) => (get().detail[chatId]?.chat.kind === 'code' ? `code:${chatId}` : chatId);
  const setGen = (chatId: string, g: Generating) => set({ generating: { ...get().generating, [chatId]: g } });
  const clearGen = (chatId: string, abort: AbortController) => {
    if (get().generating[chatId]?.abort !== abort) return;
    const { [chatId]: _gone, ...rest } = get().generating;
    void _gone;
    const { [chatId]: _run, ...runs } = get().codeRun;
    void _run;
    set({ generating: rest, codeRun: runs });
  };

  /**
   * Akış olaylarını işleyen ortak gövde (gönder, yeniden üret, süren üretimi izle).
   * Döner: bağlantı yarıda koptuysa true (sunucuda üretim sürüyor olabilir; çağıran yeniden izler).
   */
  async function runStream(chatId: string, source: EventSource, tmp: { userId?: string; assistantId: string | null }): Promise<boolean> {
    const abort = new AbortController();
    let assistantId = tmp.assistantId ?? '';
    const gen: Generating = { chatId, assistantId, abort };
    setGen(chatId, gen);
    // Uygulama üretim sürerken kapatılırsa, yeniden açılınca bu sohbete dönülür (sonuç ya da canlı akış gösterilir).
    kv.set('sf.pending', pendingKey(chatId));

    // Delta'ları kare başına bir kez uygula (uzun yanıtlarda render maliyetini düşürür).
    let bufContent = '';
    let bufReasoning = '';
    let raf = 0;
    let tm: ReturnType<typeof setTimeout> | undefined;
    /** Şimdiye dek gelen metin miktarı: çok büyük yanıtlarda (artifact) güncellemeler seyreltilir. */
    let total = 0;
    /** Güncel düşünce parçasının başlangıcı (süre göstermek için). */
    let reasonStart = 0;
    const flush = () => {
      raf = 0;
      tm = undefined;
      if (!bufContent && !bufReasoning) return;
      const c = bufContent;
      const r = bufReasoning;
      bufContent = '';
      bufReasoning = '';
      patchMessage(chatId, assistantId, (m) => {
        let parts = m.parts;
        if (r) {
          if (!reasonStart) reasonStart = Date.now();
          parts = appendReasoning(parts, r);
        }
        if (c) {
          if (reasonStart) parts = closeReasoning(parts, Date.now() - reasonStart);
          reasonStart = 0;
          parts = appendText(parts, c);
        }
        return { ...m, content: m.content + c, reasoning: m.reasoning + r, parts };
      });
    };
    const schedule = () => {
      if (raf || tm) return;
      // Küçük yanıtta kare başına bir kez; 8 bin karakteri aşınca 120 ms'de bir (ayrıştırma/çizim maliyeti kodun boyuyla büyür).
      if (total > 8_000) tm = setTimeout(flush, 120);
      else raf = requestAnimationFrame(flush);
    };

    let finished = false;
    let gotEvent = false;
    let dropped = false;
    const onEvent = (e: StreamEvent) => {
      gotEvent = true;
      switch (e.type) {
        case 'snapshot': {
          // Sunucuda süren üretime yeniden bağlandık: o ana kadarki mesaj durumu gelir, sonrası canlı akar.
          bufContent = '';
          bufReasoning = '';
          const snap = e.assistantMessage;
          patchDetail(chatId, (d) => ({
            ...d,
            messages: d.messages.some((m) => m.id === snap.id) ? d.messages.map((m) => (m.id === snap.id ? snap : m)) : [...d.messages, snap],
            chat: { ...d.chat, leafId: snap.id },
          }));
          total = snap.content.length + snap.reasoning.length;
          assistantId = snap.id;
          gen.assistantId = snap.id;
          setGen(chatId, gen);
          break;
        }
        case 'start': {
          flush();
          const realA = e.assistantMessage;
          patchDetail(chatId, (d) => ({
            ...d,
            messages: d.messages.map((m) => {
              if (m.id === tmp.userId && e.userMessage) return e.userMessage;
              if (m.id === assistantId) return { ...realA, content: m.content, reasoning: m.reasoning, parts: m.parts };
              return m;
            }),
            chat: { ...d.chat, leafId: realA.id, lastMessageAt: realA.createdAt },
          }));
          assistantId = realA.id;
          gen.assistantId = realA.id;
          setGen(chatId, gen);
          const d = get().detail[chatId];
          if (d) set({ chats: upsert(get().chats, d.chat) });
          break;
        }
        case 'reasoning':
          bufReasoning += e.delta;
          total += e.delta.length;
          schedule();
          break;
        case 'delta':
          bufContent += e.delta;
          total += e.delta.length;
          schedule();
          break;
        case 'tool_start':
          flush();
          patchMessage(chatId, assistantId, (m) => ({
            ...m,
            parts: [...(reasonStart ? closeReasoning(m.parts, Date.now() - reasonStart) : m.parts), { type: 'tool', id: e.id, name: e.name, args: e.args, status: 'running' }],
          }));
          reasonStart = 0;
          break;
        case 'tool_end':
          flush();
          patchMessage(chatId, assistantId, (m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.type === 'tool' && p.id === e.id ? { ...p, status: e.status, output: e.output, summary: e.summary, meta: e.meta, ms: e.ms } : p,
            ),
          }));
          break;
        case 'phase':
          set({ codeRun: { ...get().codeRun, [chatId]: { phase: e.phase, position: e.position, startedAt: e.elapsedMs === undefined ? get().codeRun[chatId]?.startedAt : Date.now() - e.elapsedMs } } });
          break;
        case 'changes':
          useCode.getState().patchSession(chatId, { additions: e.additions, deletions: e.deletions, filesChanged: e.files, headSha: e.sha ?? undefined });
          break;
        case 'context':
          useCode.getState().patchSession(chatId, { contextTokens: e.tokens, contextLimit: e.limit });
          break;
        case 'title': {
          const d = get().detail[chatId];
          if (d) patchChat({ ...d.chat, title: e.title });
          break;
        }
        case 'memory':
          useUi.getState().toast({ kind: 'success', text: `${translate('settings.memory')}: ${e.memory.content}` });
          break;
        case 'usage':
          useUi.getState().setUsage(e.usage);
          break;
        case 'error':
          useUi.getState().toast({ kind: 'error', text: e.message });
          break;
        case 'done':
          finished = true;
          flush();
          patchMessage(chatId, assistantId, () => ({ ...e.assistantMessage, parts: e.assistantMessage.parts ?? [] }));
          clearGen(chatId, abort);
          break;
      }
    };

    try {
      await source(onEvent, abort.signal);
      // Sunucu olay gönderdi ama 'done' gelmeden bağlantıyı kapattı (ör. sunucu yeniden başladı): kopma say.
      if (!finished && gotEvent && !abort.signal.aborted) dropped = true;
    } catch (err) {
      const network = err instanceof ApiError && err.status === 0;
      if (abort.signal.aborted) {
        dropped = Boolean(gen.reconnect);
      } else if (network && assistantId && !assistantId.startsWith('tmp-')) {
        // İstek sunucuya ulaşmıştı (gerçek kimlik var): ağ koptu / uygulama arka plana alındı. Sunucuda üretim sürer; yeniden izlenecek.
        dropped = true;
      } else {
        reportError(err);
        flush();
        patchDetail(chatId, (d) => ({
          ...d,
          messages: d.messages.map((m) => (m.id === assistantId && m.status === 'streaming' ? { ...m, status: 'error' } : m)),
        }));
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (tm) clearTimeout(tm);
      flush();
      if (!finished && !dropped) {
        // Kullanıcı durdurdu ya da yerel hata: yerel durumu işaretle.
        patchMessage(chatId, assistantId, (m) => (m.status === 'streaming' ? { ...m, status: abort.signal.aborted ? 'stopped' : 'error' } : m));
      }
      clearGen(chatId, abort);
      if (!dropped && kv.get('sf.pending') === pendingKey(chatId)) kv.remove('sf.pending');
      // Sunucu ile kesin eşitleme (gerçek kimlikler, durum). Kopma durumunda yeniden izleme bunu zaten yapar.
      if (!dropped) void get().openChat(chatId, true);
    }
    return dropped;
  }

  return {
    chats: [],
    archived: null,
    chatsLoaded: false,
    detail: {},
    activeId: null,
    loadingId: null,
    loadError: null,
    generating: {},
    codeRun: {},
    draftPersona: null,

    reset: () =>
      set({ chats: [], archived: null, chatsLoaded: false, detail: {}, activeId: null, loadingId: null, loadError: null, generating: {}, codeRun: {} }),

    async loadChats() {
      try {
        const { chats } = await api.chats();
        set({ chats: sortChats(chats), chatsLoaded: true });
      } catch (err) {
        set({ chatsLoaded: true });
        reportError(err);
      }
    },

    async loadArchived() {
      try {
        set({ archived: (await api.chats({ archived: true })).chats });
      } catch (err) {
        reportError(err);
      }
    },

    async openChat(id: string, silent = false) {
      if (!silent) set({ activeId: id });
      if (get().generating[id]) return;
      if (!silent) set({ loadingId: get().detail[id] ? null : id, loadError: null });
      try {
        const d = await api.chat(id);
        if (get().generating[id]) return; // akış sürerken üzerine yazma
        set({ detail: { ...get().detail, [id]: { chat: d.chat, messages: d.messages } }, loadingId: null });
        if (get().chats.some((c) => c.id === id)) patchChat(d.chat);
        // Sunucuda hâlâ üretilen bir yanıt varsa (uygulama kapatılıp açıldı, başka cihazdan başlatıldı…) canlı izle.
        if (d.messages.some((m) => m.role === 'assistant' && m.status === 'streaming')) void get().follow(id);
      } catch (err) {
        const notFound = (err as { status?: number }).status === 404;
        set({ loadingId: null, loadError: notFound ? 'notfound' : 'error' });
        if (!notFound) reportError(err, 'chat.loadError');
      }
    },

    newChat: () => set({ activeId: null, loadError: null, loadingId: null }),
    setDraftPersona: (draftPersona) => set({ draftPersona }),

    async send({ content, attachments = [], chatId, parentId, onChatCreated, planMode }) {
      if (chatId && get().generating[chatId]) return;
      let id = chatId ?? null;
      try {
        if (!id) {
          const persona = get().draftPersona ?? undefined;
          const { chat } = await api.createChat({ personaId: persona && persona !== 'default' ? persona : undefined });
          id = chat.id;
          set({ detail: { ...get().detail, [id]: { chat, messages: [] } }, activeId: id });
          onChatCreated?.(id);
        }
      } catch (err) {
        reportError(err);
        return;
      }

      const detail = get().detail[id]!;
      const parent = parentId === undefined ? detail.chat.leafId : parentId;
      const userTmp = blankMessage({
        id: tmpId('u'),
        chatId: id,
        role: 'user',
        parentId: parent,
        content,
        attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, text: a.text })),
      });
      const asstTmp = blankMessage({ id: tmpId('a'), chatId: id, role: 'assistant', parentId: userTmp.id, status: 'streaming' });
      patchDetail(id, (d) => ({
        ...d,
        messages: [...d.messages, userTmp, asstTmp],
        chat: { ...d.chat, leafId: asstTmp.id },
      }));

      const chat = id;
      const body = {
        content,
        parentId: parent,
        mode: useUi.getState().mode,
        effort: useUi.getState().effort,
        attachments: attachments.length ? attachments.map(({ name, mime, text }) => ({ name, mime, text })) : undefined,
        planMode: planMode || undefined,
      };
      const dropped = await runStream(chat, (onEvent, signal) => streamRequest(`/chats/${chat}/messages`, body, onEvent, signal), {
        userId: userTmp.id,
        assistantId: asstTmp.id,
      });
      if (dropped) void get().follow(chat);
    },

    async regenerate(chatId, messageId) {
      if (get().generating[chatId]) return;
      const detail = get().detail[chatId];
      const target = detail?.messages.find((m) => m.id === messageId);
      if (!detail || !target?.parentId) return;
      const asstTmp = blankMessage({ id: tmpId('a'), chatId, role: 'assistant', parentId: target.parentId, status: 'streaming' });
      patchDetail(chatId, (d) => ({ ...d, messages: [...d.messages, asstTmp], chat: { ...d.chat, leafId: asstTmp.id } }));
      const body = { messageId, mode: useUi.getState().mode, effort: useUi.getState().effort };
      const dropped = await runStream(chatId, (onEvent, signal) => streamRequest(`/chats/${chatId}/regenerate`, body, onEvent, signal), {
        assistantId: asstTmp.id,
      });
      if (dropped) void get().follow(chatId);
    },

    stop(chatId) {
      const g = get().generating[chatId];
      if (!g) return;
      // Sunucuda üretim bağlantıdan bağımsız sürdüğü için durdurma ayrıca bildirilir.
      void api.stopChat(chatId).catch(() => {});
      g.abort.abort();
    },

    async follow(chatId) {
      if (get().generating[chatId]) return;
      // Kopma sürerse (ağ yok, uygulama arka planda) artan aralıklarla birkaç kez dene.
      for (let attempt = 0; attempt < 6; attempt++) {
        const streaming = get().detail[chatId]?.messages.find((m) => m.role === 'assistant' && m.status === 'streaming');
        const dropped = await runStream(chatId, (onEvent, signal) => streamGet(`/chats/${chatId}/stream`, onEvent, signal), {
          assistantId: streaming?.id ?? null,
        });
        if (!dropped) return;
        await sleep(1_200 * (attempt + 1));
        if (get().generating[chatId]) return; // bu arada başka biri yeniden bağlandı
      }
      void get().openChat(chatId, true);
    },

    refreshActive() {
      const id = get().activeId;
      if (id) get().refresh(id);
    },

    refresh(id) {
      const g = get().generating[id];
      if (g) {
        // Arka plandayken soket sessizce ölmüş olabilir: bilerek kesip anlık görüntüyle yeniden bağlan.
        g.reconnect = true;
        g.abort.abort();
        void sleep(50).then(() => get().follow(id));
        return;
      }
      void get().openChat(id, true);
    },

    switchVersion(chatId, messageId) {
      if (get().generating[chatId]) return;
      const d = get().detail[chatId];
      if (!d) return;
      const leaf = deepestLeaf(indexMessages(d.messages), messageId);
      patchDetail(chatId, (x) => ({ ...x, chat: { ...x.chat, leafId: leaf } }));
      void api.updateChat(chatId, { leafId: messageId }).catch((err) => reportError(err));
    },

    async renameChat(id, title) {
      try {
        patchChat((await api.updateChat(id, { title })).chat);
      } catch (err) {
        reportError(err);
      }
    },

    async pinChat(id, pinned) {
      try {
        patchChat((await api.updateChat(id, { pinned })).chat);
      } catch (err) {
        reportError(err);
      }
    },

    async archiveChat(id, archived) {
      try {
        const { chat } = await api.updateChat(id, { archived });
        set({
          chats: archived ? get().chats.filter((c) => c.id !== id) : upsert(get().chats, chat),
          archived: get().archived ? (archived ? upsert(get().archived!, chat) : get().archived!.filter((c) => c.id !== id)) : null,
        });
        patchDetail(id, (d) => ({ ...d, chat }));
      } catch (err) {
        reportError(err);
      }
    },

    async deleteChat(id) {
      try {
        await api.deleteChat(id);
        const { [id]: _removed, ...rest } = get().detail;
        void _removed;
        set({
          chats: get().chats.filter((c) => c.id !== id),
          archived: get().archived?.filter((c) => c.id !== id) ?? null,
          detail: rest,
        });
        return true;
      } catch (err) {
        reportError(err);
        return false;
      }
    },

    async setPersona(id, personaId) {
      try {
        patchChat((await api.updateChat(id, { personaId })).chat);
      } catch (err) {
        reportError(err);
      }
    },

    async setFeedback(chatId, messageId, value) {
      const before = get().detail[chatId]?.messages.find((m) => m.id === messageId)?.feedback ?? null;
      patchMessage(chatId, messageId, (m) => ({ ...m, feedback: value }));
      try {
        await api.feedback(messageId, value);
      } catch (err) {
        patchMessage(chatId, messageId, (m) => ({ ...m, feedback: before }));
        reportError(err);
      }
    },
  };
});

/** Seçili sohbetin aktif mesaj yolu. */
export function selectPath(detail: ChatDetail | undefined): MessageDTO[] {
  if (!detail) return [];
  return activePath(indexMessages(detail.messages), detail.chat.leafId);
}
