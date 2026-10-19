import { create } from 'zustand';
import type { CodeEnvironmentDTO, CodeSessionDTO, CodeStatusDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import type { PendingAttachment } from '../lib/types.ts';

const DRAFT_KEY = 'sf.code.draft';

export interface CodeDraft {
  repo: string | null;
  baseBranch: string | null;
  environmentId: string | null;
}

function readDraft(): CodeDraft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<CodeDraft>;
    return { repo: d.repo ?? null, baseBranch: d.baseBranch ?? null, environmentId: d.environmentId ?? null };
  } catch {
    return { repo: null, baseBranch: null, environmentId: null };
  }
}

export interface QueuedMessage {
  text: string;
  plan: boolean;
  attachments?: PendingAttachment[];
}

interface CodeState {
  status: CodeStatusDTO | null;
  envs: CodeEnvironmentDTO[] | null;
  sessions: CodeSessionDTO[] | null;
  archived: CodeSessionDTO[] | null;
  loadError: string | null;
  /** Yeni oturum ekranında seçilenler (son seçim hatırlanır). */
  draft: CodeDraft;
  /** Oturum başına plan modu anahtarı. */
  plan: Record<string, boolean>;
  /** Ajan çalışırken yazılan, tur bitince sırayla gönderilecek mesajlar. */
  queue: Record<string, QueuedMessage[]>;
  setPlan: (chatId: string, on: boolean) => void;
  enqueue: (chatId: string, m: QueuedMessage) => void;
  takeQueued: (chatId: string) => QueuedMessage | undefined;
  removeQueued: (chatId: string, index: number) => void;

  setDraft: (patch: Partial<CodeDraft>) => void;
  loadStatus: () => Promise<void>;
  loadEnvs: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadArchived: () => Promise<void>;
  /** Ad / sabitleme / arşiv değişikliği; listeler yeniden çekilir (sıra sunucuda belirlenir). */
  updateSession: (chatId: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => Promise<boolean>;
  /** Ana ekran açılırken: durum + (izinliyse) ortamlar ve oturumlar. */
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  /** GitHub'dan dönen kodu oturumumuzla tamamlar (state'i başlatan kullanıcı biziz). */
  completeGithub: (code: string, state: string) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  saveEnv: (id: string | null, input: object) => Promise<CodeEnvironmentDTO | null>;
  deleteEnv: (id: string) => Promise<boolean>;
  createSession: (input: { repo: string; baseBranch: string; environmentId?: string }) => Promise<CodeSessionDTO | null>;
  deleteSession: (chatId: string) => Promise<boolean>;
}

export const useCode = create<CodeState>((set, get) => ({
  status: null,
  envs: null,
  sessions: null,
  archived: null,
  loadError: null,
  draft: readDraft(),
  plan: {},
  queue: {},

  setPlan: (chatId, on) => set((s) => ({ plan: { ...s.plan, [chatId]: on } })),
  enqueue: (chatId, m) => set((s) => ({ queue: { ...s.queue, [chatId]: [...(s.queue[chatId] ?? []), m] } })),
  takeQueued(chatId) {
    const [first, ...rest] = get().queue[chatId] ?? [];
    if (first) set((s) => ({ queue: { ...s.queue, [chatId]: rest } }));
    return first;
  },
  removeQueued: (chatId, index) => set((s) => ({ queue: { ...s.queue, [chatId]: (s.queue[chatId] ?? []).filter((_, i) => i !== index) } })),

  setDraft(patch) {
    const draft = { ...get().draft, ...patch };
    set({ draft });
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* yoksay */
    }
  },

  async loadStatus() {
    try {
      set({ status: await api.codeStatus(), loadError: null });
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },
  async loadEnvs() {
    try {
      const { environments } = await api.codeEnvs();
      set({ envs: environments });
      // Seçili ortam silinmişse ilkine dön.
      const { draft } = get();
      if (!environments.some((e) => e.id === draft.environmentId)) get().setDraft({ environmentId: environments[0]?.id ?? null });
    } catch (err) {
      reportError(err);
    }
  },
  async loadSessions() {
    try {
      set({ sessions: (await api.codeSessions()).sessions });
    } catch (err) {
      reportError(err);
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
      await Promise.all([get().loadSessions(), get().archived ? get().loadArchived() : Promise.resolve()]);
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },
  async refresh() {
    await get().loadStatus();
    if (get().status?.allowed) await Promise.all([get().loadEnvs(), get().loadSessions()]);
  },

  async connect() {
    try {
      const { url } = await api.codeGithubStart();
      window.location.href = url;
    } catch (err) {
      reportError(err);
    }
  },
  async completeGithub(code, state) {
    try {
      await api.codeGithubComplete(code, state);
      await get().loadStatus();
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },
  async disconnect() {
    try {
      await api.codeGithubDisconnect();
      await get().loadStatus();
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },

  async saveEnv(id, input) {
    try {
      const { environment } = id ? await api.updateCodeEnv(id, input) : await api.createCodeEnv(input);
      await get().loadEnvs();
      return environment;
    } catch (err) {
      reportError(err);
      return null;
    }
  },
  async deleteEnv(id) {
    try {
      await api.deleteCodeEnv(id);
      await Promise.all([get().loadEnvs(), get().loadSessions()]);
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },

  async createSession(input) {
    try {
      const { session } = await api.createCodeSession(input);
      set((s) => ({ sessions: [session, ...(s.sessions ?? [])] }));
      return session;
    } catch (err) {
      reportError(err);
      return null;
    }
  },
  async deleteSession(chatId) {
    try {
      await api.deleteCodeSession(chatId);
      set((s) => ({ sessions: (s.sessions ?? []).filter((x) => x.chatId !== chatId), archived: s.archived && s.archived.filter((x) => x.chatId !== chatId) }));
      return true;
    } catch (err) {
      reportError(err);
      return false;
    }
  },
}));
