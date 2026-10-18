import { create } from 'zustand';
import { Linking } from 'react-native';
import type { CodeEnvironmentDTO, CodeSessionDTO, CodeStatusDTO } from '@sixfinger/shared';
import { api, ApiError } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { translate } from '../lib/i18n/index.ts';
import { useUi } from './ui.ts';

interface CodeState {
  status: CodeStatusDTO | null;
  sessions: CodeSessionDTO[] | null;
  environments: CodeEnvironmentDTO[] | null;
  loading: boolean;
  /** GitHub izin sayfası tarayıcıda açıldı; uygulamaya dönünce durum yenilenir. */
  connecting: boolean;
  /** Yeni oturum ekranında yazılan ilk görev (Faz 1'de çalıştırma yok; oturum ekranında gösterilir). */
  firstTask: Record<string, string>;

  loadAll: () => Promise<void>;
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
  setFirstTask: (chatId: string, text: string) => void;
  reset: () => void;
}

const handledStates = new Set<string>();

const initial = { status: null, sessions: null, environments: null, loading: false, connecting: false, firstTask: {} };

export const useCode = create<CodeState>((set, get) => ({
  ...initial,

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
  upsertSession: (s) => set({ sessions: [s, ...(get().sessions ?? []).filter((x) => x.chatId !== s.chatId)] }),
  removeSession: (id) => set({ sessions: (get().sessions ?? []).filter((x) => x.chatId !== id) }),
  setFirstTask: (chatId, text) => set({ firstTask: { ...get().firstTask, [chatId]: text } }),
  reset: () => set(initial),
}));
