import { create } from 'zustand';
import type { UsageDTO } from '@sixfinger/shared';
import type { Effort } from '../lib/types.ts';
import type { FullConfig } from '../lib/api.ts';
import { kv } from '../lib/storage.ts';

export type ThemePref = 'dark' | 'light' | 'system';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

interface UiState {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;

  config: FullConfig | null;
  setConfig: (c: FullConfig | null) => void;
  setUsage: (u: UsageDTO) => void;

  effort: Effort;
  setEffort: (e: Effort) => void;

  /** Kenar çekmecesi açık mı? (Sürükleme animasyonu bileşen içinde; bu yalnızca mantıksal durum.) */
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;
}

let toastId = 0;

/** Depo (kv) yüklendikten sonra çağrılır; başlangıç değerlerini okur. */
export function hydrateUi(): void {
  useUi.setState({
    theme: (kv.get('sf.theme') as ThemePref | null) ?? 'dark',
    effort: (kv.get('sf.effort') as Effort | null) ?? 'low',
  });
}

export const useUi = create<UiState>((set, get) => ({
  theme: 'dark',
  setTheme: (theme) => {
    kv.set('sf.theme', theme);
    set({ theme });
  },

  toasts: [],
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.action ? 6_000 : 3_500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  config: null,
  setConfig: (config) => set({ config }),
  setUsage: (usage) => {
    const c = get().config;
    if (c) set({ config: { ...c, usage } });
  },

  effort: 'low',
  setEffort: (effort) => {
    kv.set('sf.effort', effort);
    set({ effort });
  },

  drawerOpen: false,
  setDrawer: (drawerOpen) => set({ drawerOpen }),
}));
