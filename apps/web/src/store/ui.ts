import { create } from 'zustand';
import { legacyModeFromEffort, type ChatMode } from '@sixfinger/shared';
import type { Effort } from '../lib/types.ts';
import type { FullConfig } from '../lib/api.ts';
import type { UsageDTO } from '@sixfinger/shared';
import { setStatusBar } from '../lib/native.ts';

export type ThemePref = 'dark' | 'light' | 'system';
export type SettingsTab = 'general' | 'personal' | 'memory' | 'data' | 'account';
export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* yoksay */
  }
};

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  void setStatusBar(dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b0b0c' : '#fafaf9');
}

interface UiState {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;

  sidebarCollapsed: boolean; // masaüstü
  mobileSidebarOpen: boolean;
  toggleSidebar: () => void;
  setMobileSidebar: (open: boolean) => void;

  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;

  authMode: AuthMode | null;
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;

  paletteOpen: boolean;
  setPalette: (open: boolean) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;

  config: FullConfig | null;
  setConfig: (c: FullConfig | null) => void;
  setUsage: (u: UsageDTO) => void;

  /** Hangi modelin yanıtlayacağı (Hızlı / Dengeli / Derin). */
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
  /** Düşünme düzeyi; Derin mod desteklemez. */
  effort: Effort;
  setEffort: (e: Effort) => void;

  online: boolean;

  /** Açık artifact paneli (kimlik). */
  artifactId: string | null;
  openArtifact: (id: string) => void;
  closeArtifact: () => void;

  /** Widget'ın önerdiği metin: composer'a yazılır, kendiliğinden gönderilmez. */
  prefill: { text: string; n: number } | null;
  setPrefill: (text: string) => void;
}

let toastId = 0;
const isMode = (v: string | null): v is ChatMode => v === 'fast' || v === 'balanced' || v === 'deep';
const isEffort = (v: string | null): v is Effort => v === 'low' || v === 'medium' || v === 'high';
// Eski sürümde `sf.effort` modu belirliyordu; ilk açılışta oradan taşınır.
const savedMode = read('sf.mode');
const initialMode: ChatMode = isMode(savedMode) ? savedMode : legacyModeFromEffort(isEffort(read('sf.effort')) ? (read('sf.effort') as Effort) : undefined);
const savedThinking = read('sf.thinking');
const initialEffort: Effort = isEffort(savedThinking) ? savedThinking : 'medium';

export const useUi = create<UiState>((set, get) => ({
  theme: (read('sf.theme') as ThemePref | null) ?? 'dark',
  setTheme: (theme) => {
    write('sf.theme', theme);
    applyTheme(theme);
    set({ theme });
  },

  sidebarCollapsed: read('sf.sidebar') === 'collapsed',
  mobileSidebarOpen: false,
  toggleSidebar: () => {
    if (window.matchMedia('(max-width: 860px)').matches) {
      set({ mobileSidebarOpen: !get().mobileSidebarOpen });
    } else {
      const collapsed = !get().sidebarCollapsed;
      write('sf.sidebar', collapsed ? 'collapsed' : 'open');
      set({ sidebarCollapsed: collapsed });
    }
  },
  setMobileSidebar: (mobileSidebarOpen) => set({ mobileSidebarOpen }),

  settingsTab: null,
  openSettings: (tab = 'general') => set({ settingsTab: tab, mobileSidebarOpen: false }),
  closeSettings: () => set({ settingsTab: null }),

  authMode: null,
  openAuth: (mode = 'login') => set({ authMode: mode, mobileSidebarOpen: false }),
  closeAuth: () => set({ authMode: null }),

  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),

  toasts: [],
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.action ? 7_000 : 4_000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  config: null,
  setConfig: (config) => set({ config }),
  setUsage: (usage) => {
    const c = get().config;
    if (c) set({ config: { ...c, usage } });
  },

  mode: initialMode,
  setMode: (mode) => {
    write('sf.mode', mode);
    set({ mode });
  },
  effort: initialEffort,
  setEffort: (effort) => {
    write('sf.thinking', effort);
    set({ effort });
  },

  online: typeof navigator === 'undefined' ? true : navigator.onLine,

  artifactId: null,
  openArtifact: (artifactId) => set({ artifactId, mobileSidebarOpen: false }),
  closeArtifact: () => set({ artifactId: null }),

  prefill: null,
  setPrefill: (text) => set({ prefill: { text, n: Date.now() } }),
}));
