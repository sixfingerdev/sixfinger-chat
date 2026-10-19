import { create } from 'zustand';
import { Linking } from 'react-native';
import type { CodeEnvironmentDTO, CodeQueueItemDTO, CodeSessionDTO, CodeStatusDTO } from '@sixfinger/shared';
import { api, ApiError } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { translate } from '../lib/i18n/index.ts';
import type { PendingAttachment } from '../lib/types.ts';
import { useUi } from './ui.ts';

/** Sıraya eklenecek mesaj (ekler sunucuya düz metin olarak gider). */
export interface QueuedMessage {
  text: string;
  plan: boolean;
  attachments?: PendingAttachment[];
}

interface CodeState {
  status: CodeStatusDTO | null;
  sessions: CodeSessionDTO[] | null;
  /** Arşiv bölümü açılınca yüklenir (açılmamışsa null). */
  archived: CodeSessionDTO[] | null;
  environments: CodeEnvironmentDTO[] | null;
  loading: boolean;
  /** GitHub izin sayfası tarayıcıda açıldı; uygulamaya dönünce durum yenilenir. */
  connecting: boolean;
  /** Yeni oturum ekranında yazılan ilk görev: oturum ekranı açılınca bir kez gönderilir. */
  pendingPrompt: Record<string, string>;
  /** Oturum başına plan modu anahtarı. */
  plan: Record<string, boolean>;
  /** Ajan çalışırken eklenen mesajlar: SUNUCUDA tutulur ve tur bitince sunucu başlatır; burada yalnızca görünümü. */
  queue: Record<string, CodeQueueItemDTO[]>;
  setPlan: (chatId: string, on: boolean) => void;
  loadQueue: (chatId: string) => Promise<void>;
  /** Sıraya ekler. Döner: sunucu hemen başlattıysa (çalışma yoktu) true. */
  enqueue: (chatId: string, m: QueuedMessage) => Promise<boolean>;
  removeQueued: (chatId: string, id: string) => Promise<void>;

  loadAll: () => Promise<void>;
  loadArchived: () => Promise<void>;
  /** Ad / sabitleme / arşiv değişikliği; listeler yeniden çekilir (sıra sunucuda belirlenir). */
  updateSession: (chatId: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => Promise<boolean>;
  loadStatus: () => Promise<void>;
  loadEnvironments: () => Promise<void>;
  connectGithub: () => Promise<void>;
  /** Tarayıcıdan dönen `gh_code`/`gh_state` ile bağlantıyı bu oturumla tamamlar. Aynı `state` ikinci kez işlenmez. */
  completeGithub: (code: string, state: string) => Promise<void>;
  disconnectGithub: () => Promise<void>;
  upsertEnvironment: (e: CodeEnvironmentDTO) => void;
  removeEnvironment: (id: string) => void;
  upsertSession: (s: CodeSessionDTO) => void;
  removeSession: (id: string) => void;
  setPendingPrompt: (chatId: string, text: string) => void;
  /** Bekleyen ilk görevi döndürür ve siler (yalnızca bir kez gönderilsin diye). */
  takePendingPrompt: (chatId: string) => string | undefined;
  /** Akış olaylarıyla (bağlam, değişiklik) oturum kartını yerinde günceller. */
  patchSession: (chatId: string, patch: Partial<CodeSessionDTO>) => void;
  reset: () => void;
}

const handledStates = new Set<string>();

const initial = { status: null, sessions: null, archived: null, environments: null, loading: false, connecting: false, pendingPrompt: {}, plan: {}, queue: {} };

export const useCode = create<CodeState>((set, get) => ({
  ...initial,

  setPlan: (chatId, on) => set((s) => ({ plan: { ...s.plan, [chatId]: on } })),
  async loadQueue(chatId) {
    try {
      const { queue } = await api.codeQueue(chatId);
      set((s) => ({ queue: { ...s.queue, [chatId]: queue } }));
    } catch {
      /* ağ hatası: eldeki görünüm kalır */
    }
  },
  async enqueue(chatId, m) {
    try {
      const r = await api.codeEnqueue(chatId, {
        content: m.text,
        planMode: m.plan,
        attachments: m.attachments?.map((a) => ({ name: a.name, mime: a.mime, text: a.text })),
      });
      set((s) => ({ queue: { ...s.queue, [chatId]: r.queue } }));
      return r.started;
    } catch (err) {
      reportError(err);
      return false;
    }
  },
  async removeQueued(chatId, id) {
    set((s) => ({ queue: { ...s.queue, [chatId]: (s.queue[chatId] ?? []).filter((q) => q.id !== id) } }));
    try {
      await api.codeQueueRemove(chatId, id);
    } catch (err) {
      reportError(err);
      void get().loadQueue(chatId);
    }
  },

  async loadStatus() {
    try {
      set({ status: await api.codeStatus() });
    } catch (err) {
      // Eski sunucuda uç yoksa Code yokmuş gibi davran.
      if (err instanceof ApiError && err.status === 404) set({ status: { available: false, allowed: false, github: null, credits: { used: 0, limit: 0, resetsAt: new Date().toISOString() } } });
      else throw err;
    }
  },

  async loadEnvironments() {
    set({ environments: (await api.codeEnvironments()).environments });
  },

  async loadAll() {
    set({ loading: true });
    try {
      await get().loadStatus();
      if (get().status?.allowed) {
        const [sessions, environments] = await Promise.all([api.codeSessions(), api.codeEnvironments()]);
        set({ sessions: sessions.sessions, environments: environments.environments });
      }
    } catch (err) {
      reportError(err);
    } finally {
      set({ loading: false });
    }
  },

  async loadArchived() {
    try {
      set({ archived: (await api.codeSessions(true)).sessions });
    } catch (err) {
      reportError(err);
    }
  },
  async updateSession(chatId, patch) {
    try {
      await api.updateChat(chatId, patch);
      const [active, archived] = await Promise.all([api.codeSessions(), get().archived ? api.codeSessions(true) : Promise.resolve(null)]);
      set({ sessions: active.sessions, ...(archived ? { archived: archived.sessions } : {}) });
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },

  async connectGithub() {
    try {
      const { url } = await api.codeGithubStart();
      set({ connecting: true });
      useUi.getState().toast({ kind: 'info', text: translate('code.github.waiting') });
      await Linking.openURL(url);
    } catch (err) {
      set({ connecting: false });
      reportError(err);
    }
  },

  async completeGithub(code, state) {
    if (handledStates.has(state)) return;
    handledStates.add(state);
    set({ connecting: true });
    try {
      await api.codeGithubComplete(code, state);
      useUi.getState().toast({ kind: 'success', text: translate('code.github.ok') });
      await get().loadAll();
    } catch {
      useUi.getState().toast({ kind: 'error', text: translate('code.github.error') });
    } finally {
      set({ connecting: false });
    }
  },

  async disconnectGithub() {
    try {
      await api.codeGithubDisconnect();
      const st = get().status;
      if (st) set({ status: { ...st, github: null } });
    } catch (err) {
      reportError(err);
    }
  },

  upsertEnvironment: (e) => {
    const list = get().environments ?? [];
    set({ environments: list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e] });
  },
  removeEnvironment: (id) => set({ environments: (get().environments ?? []).filter((x) => x.id !== id) }),
  upsertSession: (s) => {
    const without = (list: CodeSessionDTO[] | null) => (list ?? []).filter((x) => x.chatId !== s.chatId);
    // Arşivdeki oturum etkin listeye karışmaz; yerinde güncellenir (sıra sunucudan gelir).
    if (s.archived) set({ sessions: without(get().sessions), archived: [s, ...without(get().archived)] });
    else {
      const old = get().sessions?.findIndex((x) => x.chatId === s.chatId) ?? -1;
      const list = without(get().sessions);
      if (old >= 0) list.splice(old, 0, s);
      else list.unshift(s);
      set({ sessions: list, archived: get().archived && without(get().archived) });
    }
  },
  removeSession: (id) => set({ sessions: (get().sessions ?? []).filter((x) => x.chatId !== id), archived: get().archived && get().archived!.filter((x) => x.chatId !== id) }),
  setPendingPrompt: (chatId, text) => set({ pendingPrompt: { ...get().pendingPrompt, [chatId]: text } }),
  takePendingPrompt: (chatId) => {
    const text = get().pendingPrompt[chatId];
    if (text === undefined) return undefined;
    const { [chatId]: _taken, ...rest } = get().pendingPrompt;
    void _taken;
    set({ pendingPrompt: rest });
    return text;
  },
  patchSession: (chatId, patch) => set({ sessions: (get().sessions ?? []).map((x) => (x.chatId === chatId ? { ...x, ...patch } : x)) }),
  reset: () => set(initial),
}));
