import { create } from 'zustand';
import type { ChatDTO, MessageDTO, StreamEvent } from '@sixfinger/shared';
import { api, streamRequest } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { translate } from '../lib/i18n/index.ts';
import type { PendingAttachment } from '../lib/types.ts';
import { activePath, deepestLeaf, indexMessages } from '../lib/tree.ts';
import { useUi } from './ui.ts';

export interface ChatDetail {
  chat: ChatDTO;
  messages: MessageDTO[];
}

export interface Generating {
  chatId: string;
  assistantId: string;
  abort: AbortController;
}

interface ChatsState {
  chats: ChatDTO[];
  archived: ChatDTO[] | null;
  chatsLoaded: boolean;
  detail: Record<string, ChatDetail>;
  activeId: string | null;
  loadingId: string | null;
  loadError: 'notfound' | 'error' | null;
  generating: Generating | null;
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
  }) => Promise<void>;
  regenerate: (chatId: string, messageId: string) => Promise<void>;
  stop: () => void;
  switchVersion: (chatId: string, messageId: string) => void;

  renameChat: (id: string, title: string) => Promise<void>;
  pinChat: (id: string, pinned: boolean) => Promise<void>;
  archiveChat: (id: string, archived: boolean) => Promise<void>;
  deleteChat: (id: string) => Promise<boolean>;
  setPersona: (id: string, personaId: string) => Promise<void>;
  setFeedback: (chatId: string, messageId: string, value: 1 | -1 | null) => Promise<void>;
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

  /** Akış olaylarını işleyen ortak gövde (gönder + yeniden üret). */
  async function runStream(
    chatId: string,
    path: string,
    body: object,
    tmp: { userId?: string; assistantId: string },
  ) {
    const abort = new AbortController();
    let assistantId = tmp.assistantId;
    set({ generating: { chatId, assistantId, abort } });

    // Delta'ları kare başına bir kez uygula (uzun yanıtlarda render maliyetini düşürür).
    let bufContent = '';
    let bufReasoning = '';
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!bufContent && !bufReasoning) return;
      const c = bufContent;
      const r = bufReasoning;
      bufContent = '';
      bufReasoning = '';
      patchMessage(chatId, assistantId, (m) => ({ ...m, content: m.content + c, reasoning: m.reasoning + r }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(flush);
    };

    let finished = false;
    const onEvent = (e: StreamEvent) => {
      switch (e.type) {
        case 'start': {
          flush();
          const realA = e.assistantMessage;
          patchDetail(chatId, (d) => ({
            ...d,
            messages: d.messages.map((m) => {
              if (m.id === tmp.userId && e.userMessage) return e.userMessage;
              if (m.id === assistantId) return { ...realA, content: m.content, reasoning: m.reasoning };
              return m;
            }),
            chat: { ...d.chat, leafId: realA.id, lastMessageAt: realA.createdAt },
          }));
          assistantId = realA.id;
          set({ generating: { chatId, assistantId, abort } });
          const d = get().detail[chatId];
          if (d) set({ chats: upsert(get().chats, d.chat) });
          break;
        }
        case 'reasoning':
          bufReasoning += e.delta;
          schedule();
          break;
        case 'delta':
          bufContent += e.delta;
          schedule();
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
          reportError(Object.assign(new Error(e.message), { name: 'ApiError' }) as never);
          useUi.getState().toast({ kind: 'error', text: e.message });
          break;
        case 'done':
          finished = true;
          flush();
          patchMessage(chatId, assistantId, () => e.assistantMessage);
          set({ generating: null });
          break;
      }
    };

    try {
      await streamRequest(path, body, onEvent, abort.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        reportError(err);
        // Başlamadan hata: geçici mesajları geri al.
        if (!finished) {
          flush();
          patchDetail(chatId, (d) => ({
            ...d,
            messages: d.messages.map((m) => (m.id === assistantId && m.status === 'streaming' ? { ...m, status: 'error' } : m)),
          }));
        }
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      flush();
      if (!finished) {
        // Durdurma ya da bağlantı kopması: yerel durumu işaretle.
        patchMessage(chatId, assistantId, (m) => (m.status === 'streaming' ? { ...m, status: abort.signal.aborted ? 'stopped' : 'error' } : m));
      }
      if (get().generating?.abort === abort) set({ generating: null });
      // Sunucu ile kesin eşitleme (gerçek kimlikler, durum).
      if (!tmp.assistantId.startsWith('tmp-') || assistantId !== tmp.assistantId) void get().openChat(chatId, true);
    }
  }

  return {
    chats: [],
    archived: null,
    chatsLoaded: false,
    detail: {},
    activeId: null,
    loadingId: null,
    loadError: null,
    generating: null,
    draftPersona: null,

    reset: () =>
      set({ chats: [], archived: null, chatsLoaded: false, detail: {}, activeId: null, loadingId: null, loadError: null, generating: null }),

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
      set({ activeId: id });
      if (get().generating?.chatId === id) return;
      if (!silent) set({ loadingId: get().detail[id] ? null : id, loadError: null });
      try {
        const d = await api.chat(id);
        if (get().generating?.chatId === id) return; // akış sürerken üzerine yazma
        set({ detail: { ...get().detail, [id]: { chat: d.chat, messages: d.messages } }, loadingId: null });
        if (get().chats.some((c) => c.id === id)) patchChat(d.chat);
      } catch (err) {
        const notFound = (err as { status?: number }).status === 404;
        set({ loadingId: null, loadError: notFound ? 'notfound' : 'error' });
        if (!notFound) reportError(err, 'chat.loadError');
      }
    },

    newChat: () => set({ activeId: null, loadError: null, loadingId: null }),
    setDraftPersona: (draftPersona) => set({ draftPersona }),

    async send({ content, attachments = [], chatId, parentId, onChatCreated }) {
      if (get().generating) return;
      let id = chatId ?? null;
      try {
        if (!id) {
          const ui = useUi.getState();
          const persona = get().draftPersona ?? undefined;
          const { chat } = await api.createChat({ personaId: persona && persona !== 'default' ? persona : undefined });
          id = chat.id;
          set({ detail: { ...get().detail, [id]: { chat, messages: [] } }, activeId: id });
          onChatCreated?.(id);
          void ui;
        }
      } catch (err) {
        reportError(err);
        return;
      }

      const detail = get().detail[id]!;
      const idx = indexMessages(detail.messages);
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
      void idx;
      patchDetail(id, (d) => ({
        ...d,
        messages: [...d.messages, userTmp, asstTmp],
        chat: { ...d.chat, leafId: asstTmp.id },
      }));

      await runStream(
        id,
        `/chats/${id}/messages`,
        {
          content,
          parentId: parent,
          effort: useUi.getState().effort,
          attachments: attachments.length ? attachments.map(({ name, mime, text }) => ({ name, mime, text })) : undefined,
        },
        { userId: userTmp.id, assistantId: asstTmp.id },
      );
    },

    async regenerate(chatId, messageId) {
      if (get().generating) return;
      const detail = get().detail[chatId];
      const target = detail?.messages.find((m) => m.id === messageId);
      if (!detail || !target?.parentId) return;
      const asstTmp = blankMessage({ id: tmpId('a'), chatId, role: 'assistant', parentId: target.parentId, status: 'streaming' });
      patchDetail(chatId, (d) => ({ ...d, messages: [...d.messages, asstTmp], chat: { ...d.chat, leafId: asstTmp.id } }));
      await runStream(
        chatId,
        `/chats/${chatId}/regenerate`,
        { messageId, effort: useUi.getState().effort },
        { assistantId: asstTmp.id },
      );
    },

    stop() {
      get().generating?.abort.abort();
    },

    switchVersion(chatId, messageId) {
      if (get().generating) return;
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
