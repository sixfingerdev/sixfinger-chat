import { create } from 'zustand';
import type { UsageDTO } from '@sixfinger/shared';
import { legacyModeFromEffort, type ChatMode } from '@sixfinger/shared';
import type { Effort } from '../lib/types.ts';
import type { FullConfig } from '../lib/api.ts';
import { kv } from '../lib/storage.ts';

export type ThemePref = 'dark' | 'light' | 'system';

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

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

  /** Hangi modelin yanıtlayacağı (Hızlı / Dengeli / Derin). */
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
  /** Düşünme düzeyi; Derin mod desteklemez. */
  effort: Effort;
  setEffort: (e: Effort) => void;

  /** Kenar çekmecesi açık mı? (Sürükleme animasyonu bileşen içinde; bu yalnızca mantıksal durum.) */
  drawerOpen: boolean;
  setDrawer: (open: boolean) => void;

  /** Düşünce bloklarının elle açılıp kapatılma durumu (mesaj kimliği → açık mı). Yoksa otomatik: düşünürken açık, cevap başlayınca kapalı. */
  reasoningOpen: Record<string, boolean>;
  setReasoningOpen: (id: string, open: boolean) => void;

  /** Uygulama içi onay paneli (native Android uyarı kutusu yerine). */
  confirmReq: ConfirmRequest | null;
  askConfirm: (req: ConfirmRequest) => void;
  closeConfirm: () => void;

  /** Tam ekran açılan artifact (kimlik). */
  artifactId: string | null;
  openArtifact: (id: string) => void;
  closeArtifact: () => void;

  /** Widget'ın önerdiği metin: composer'a yazılır, kendiliğinden gönderilmez. */
  prefill: { text: string; n: number } | null;
  setPrefill: (text: string) => void;
}

let toastId = 0;

/** Depo (kv) yüklendikten sonra çağrılır; başlangıç değerlerini okur. */
export function hydrateUi(): void {
  const isEffort = (v: string | null): v is Effort => v === 'low' || v === 'medium' || v === 'high';
  const savedMode = kv.get('sf.mode');
  const legacy = kv.get('sf.effort');
  // Eski sürümde `sf.effort` modu belirliyordu; ilk açılışta oradan taşınır.
  const mode: ChatMode =
    savedMode === 'fast' || savedMode === 'balanced' || savedMode === 'deep' ? savedMode : legacyModeFromEffort(isEffort(legacy) ? legacy : undefined);
  const thinking = kv.get('sf.thinking');
  useUi.setState({
    theme: (kv.get('sf.theme') as ThemePref | null) ?? 'dark',
    mode,
    effort: isEffort(thinking) ? thinking : 'medium',
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

  mode: 'fast',
  setMode: (mode) => {
    kv.set('sf.mode', mode);
    set({ mode });
  },
  effort: 'medium',
  setEffort: (effort) => {
    kv.set('sf.thinking', effort);
    set({ effort });
  },

  confirmReq: null,
  askConfirm: (confirmReq) => set({ confirmReq }),
  closeConfirm: () => set({ confirmReq: null }),

  reasoningOpen: {},
  setReasoningOpen: (id, open) => set((s) => ({ reasoningOpen: { ...s.reasoningOpen, [id]: open } })),

  drawerOpen: false,
  setDrawer: (drawerOpen) => set({ drawerOpen }),

  artifactId: null,
  openArtifact: (artifactId) => set({ artifactId }),
  closeArtifact: () => set({ artifactId: null }),

  prefill: null,
  setPrefill: (text) => set({ prefill: { text, n: Date.now() } }),
}));
