import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** Ekrandaki uygulamadan (asistan olarak açıldığında) sistemin verdiği içerik. */
export interface AssistContext {
  packageName: string;
  url: string | null;
  text: string;
  truncated: boolean;
}

/** Sistemin verdiği ekran görüntüsünün önizleme dosyası (bölge seçimi için). */
export interface ScreenshotInfo {
  path: string;
  width: number;
  height: number;
}

/** `lang` yalnızca tanıyıcıya özgü olaylarda gelir (çok dilli kipte her dil ayrı bir "şerit"tir). */
export type SpeechEvent =
  | { type: 'ready' | 'start' | 'end'; lang?: string }
  | { type: 'lanes'; langs: string[] }
  | { type: 'level'; value: number }
  | { type: 'partial'; lang: string; text: string }
  | { type: 'final'; lang: string; text: string; confidence: number }
  | { type: 'error'; lang?: string; code: number; message?: string };

interface Subscription {
  remove(): void;
}

interface NativeAssistant {
  getLaunchInfo(): { source: string; voice: boolean };
  getAssistContext(): AssistContext | null;
  getScreenshot(): ScreenshotInfo | null;
  cropScreenshot(left: number, top: number, right: number, bottom: number, maxSide: number, maxBytes: number): Promise<{ path: string; data: string; width: number; height: number }>;
  compressImage(uri: string, maxSide: number, maxBytes: number): Promise<{ path: string; data: string; width: number; height: number }>;
  close(): void;
  openApp(): void;
  launchOverlay(voice: boolean): void;
  isDefaultAssistant(): boolean;
  openAssistantSettings(): boolean;
  isSpeechAvailable(): boolean;
  /** `langs`: etiketler ("tr-TR"). 2+ dilde aynı ses hepsine verilir; `forceSingle` yalnızca ilk dille cihaz mikrofonunu kullanır. */
  startListening(langs: string[], forceSingle: boolean): void;
  stopListening(): void;
  cancelListening(): void;
  addListener(event: 'onSession', cb: (e: { source: string; voice: boolean }) => void): Subscription;
  addListener(event: 'onAssistContext', cb: (e: AssistContext) => void): Subscription;
  addListener(event: 'onScreenshot', cb: (e: ScreenshotInfo) => void): Subscription;
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
