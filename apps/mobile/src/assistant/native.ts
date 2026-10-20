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
