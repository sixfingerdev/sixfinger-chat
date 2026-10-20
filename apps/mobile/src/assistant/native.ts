import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** Ekrandaki uygulamadan (asistan olarak açıldığında) sistemin verdiği içerik. */
export interface AssistContext {
  packageName: string;
  url: string | null;
  text: string;
  truncated: boolean;
}

export type SpeechEvent =
  | { type: 'ready' | 'start' | 'end' }
  | { type: 'level'; value: number }
  | { type: 'partial' | 'final'; text: string }
  | { type: 'error'; code: number; message?: string };

interface Subscription {
  remove(): void;
}

interface NativeAssistant {
  getLaunchInfo(): { source: string; voice: boolean };
  getAssistContext(): AssistContext | null;
  getDiagnostics(): Record<string, unknown>;
  close(): void;
  openApp(): void;
  launchOverlay(voice: boolean): void;
  isDefaultAssistant(): boolean;
  openAssistantSettings(): boolean;
  isSpeechAvailable(): boolean;
  startListening(lang: string): void;
  stopListening(): void;
  cancelListening(): void;
  addListener(event: 'onSession', cb: (e: { source: string; voice: boolean }) => void): Subscription;
  addListener(event: 'onAssistContext', cb: (e: AssistContext) => void): Subscription;
  addListener(event: 'onHide', cb: () => void): Subscription;
  addListener(event: 'onSpeech', cb: (e: SpeechEvent) => void): Subscription;
}

/** Yerel asistan modülü; yalnızca Android'de ve modül derlenmişse vardır (aksi halde null). */
export const assistantNative: NativeAssistant | null = Platform.OS === 'android' ? (requireOptionalNativeModule('SixfingerAssistant') as unknown as NativeAssistant | null) : null;

/** "com.google.android.youtube" → "Youtube": paket adından okunur bir uygulama adı. */
export function appName(pkg: string): string {
  const skip = new Set(['com', 'org', 'net', 'io', 'android', 'app', 'apps', 'mobile', 'google', 'www', 'live']);
  const parts = pkg.split('.').filter((p) => p && !skip.has(p));
  const name = parts[parts.length - 1] ?? pkg.split('.').pop() ?? pkg;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface DiagCounter {
  n: number;
  at: number;
  err: string | null;
}

/** Tanılama sayaçlarını okunur metne çevirir (paylaşılabilir). */
export function formatDiagnostics(d: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    ready: 'servis bağlandı (onReady)',
    sessionNew: 'oturum oluştu',
    show: 'pencere istendi (onShow)',
    startActivity: 'pencere başlatıldı',
    startActivityError: 'pencere başlatma HATASI',
    assist: 'ekran içeriği geldi',
    hide: 'oturum kapandı',
    activity: 'pencere açıldı (Activity)',
    keyguard: 'kilit ekranından çağrı',
    recognizer: 'ses tanıma isteği (SixFinger tanıyıcısı)',
  };
  const lines: string[] = [String(d.device ?? '')];
  for (const k of ['assistant', 'voice_interaction_service', 'voice_recognition_service']) lines.push(`${k}: ${String(d[`setting.${k}`] ?? '—')}`);
  lines.push(`rol (ASSISTANT): ${String(d.roleHeld)}`);
  for (const [k, label] of Object.entries(labels)) {
    const c = d[k] as DiagCounter | null | undefined;
    lines.push(c ? `${label}: ${c.n}× (son ${new Date(c.at).toLocaleTimeString()})${c.err ? ` — ${c.err}` : ''}` : `${label}: hiç`);
  }
  return lines.join('\n');
}
