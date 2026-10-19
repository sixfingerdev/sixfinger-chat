import { create } from 'zustand';
import type { AuthResponse, UserDTO } from '@sixfinger/shared';
import { api, ApiError, bindSessionEvents, sessionStore } from '../lib/api.ts';
import { getLocale } from '../lib/i18n/index.ts';
import { kv } from '../lib/storage.ts';
import { useUi } from './ui.ts';
import { useChats } from './chats.ts';
import { useCode } from './code.ts';

const USER_CACHE = 'sf.user';
const cacheUser = (u: UserDTO | null) => {
  if (u) kv.set(USER_CACHE, JSON.stringify(u));
  else kv.remove(USER_CACHE);
};
const cachedUser = (): UserDTO | null => {
  try {
    const raw = kv.get(USER_CACHE);
    return raw ? (JSON.parse(raw) as UserDTO) : null;
  } catch {
    return null;
  }
};

interface AuthState {
  user: UserDTO | null;
  ready: boolean;
  bootError: string | null;
  boot: () => Promise<void>;
  applyAuth: (a: AuthResponse) => Promise<void>;
  setUser: (u: UserDTO) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (p: { email: string; password: string; displayName?: string }) => Promise<void>;
  logout: (sessionLost?: boolean) => Promise<void>;
  reloadConfig: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  bootError: null,

  async boot() {
    bindSessionEvents({
      refreshed: (a) => {
        set({ user: a.user });
        cacheUser(a.user);
      },
      lost: () => {
        void get().logout(true);
      },
    });
    try {
      if (sessionStore.read()) {
        try {
          const { user } = await api.me();
          set({ user });
          cacheUser(user);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'network') {
            const cached = cachedUser();
            if (!cached) throw err;
            set({ user: cached });
          } else {
            sessionStore.clear();
            await createGuest();
          }
        }
      } else {
        await createGuest();
      }
      await get().reloadConfig();
      void useChats.getState().loadChats();
      set({ ready: true, bootError: null });
    } catch (err) {
      set({ ready: true, bootError: err instanceof ApiError ? err.message : 'Başlatılamadı.' });
    }

    async function createGuest() {
      const a = await api.guest(getLocale());
      sessionStore.write(a);
      set({ user: a.user });
      cacheUser(a.user);
    }
  },

  async applyAuth(a) {
    sessionStore.write(a);
    cacheUser(a.user);
    set({ user: a.user });
    useChats.getState().reset();
    useCode.getState().reset();
    await get().reloadConfig();
    await useChats.getState().loadChats();
  },

  setUser(user) {
    cacheUser(user);
    set({ user });
    void get().reloadConfig();
  },

  async login(email, password) {
    await get().applyAuth(await api.login({ email, password }));
  },

  async register(p) {
    const a = await api.register({ ...p, locale: getLocale() });
    await get().applyAuth(a);
  },

  async logout(sessionLost = false) {
    const s = sessionStore.read();
    if (s && !sessionLost) await api.logout(s.refreshToken).catch(() => {});
    sessionStore.clear();
    cacheUser(null);
    useChats.getState().reset();
    useCode.getState().reset();
    useUi.getState().setConfig(null);
    set({ user: null, ready: false });
    await get().boot();
  },

  async reloadConfig() {
    try {
      useUi.getState().setConfig(await api.config());
    } catch {
      /* ağ yoksa eski yapılandırma kalsın */
    }
  },
}));
