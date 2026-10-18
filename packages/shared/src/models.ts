export interface ModelInfo {
  id: string;
  name: string;
  description: { tr: string; en: string };
  reasoning: boolean;
}

/** Şimdilik tek model: Pollinations üzerindeki `openai-fast` (GPT-OSS 20B). */
export const MODELS: ModelInfo[] = [
  {
    id: 'sixfinger-fast',
    name: 'SixFinger Fast',
    description: {
      tr: 'Hızlı ve düşünebilen genel amaçlı model.',
      en: 'Fast general-purpose reasoning model.',
    },
    reasoning: true,
  },
];

export const DEFAULT_MODEL_ID = 'sixfinger-fast';

/** Çalışma modu: hangi modelin yanıtlayacağı. */
export type ChatMode = 'fast' | 'balanced' | 'deep';
export const CHAT_MODES: readonly ChatMode[] = ['fast', 'balanced', 'deep'];
export const DEFAULT_CHAT_MODE: ChatMode = 'fast';

/** Düşünme düzeyi: `reasoning_effort` destekleyen modellerde ne kadar akıl yürütüleceği. */
export type ThinkingLevel = 'low' | 'medium' | 'high';
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high'];
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

/** Derin mod (Qwen3.8) düzeyi desteklemez: kendi başına karar verir, `reasoning_effort` ile boş yanıt döner. */
export function modeSupportsThinkingLevel(mode: ChatMode): boolean {
  return mode !== 'deep';
}

/** Eski istemciler yalnızca `effort` gönderirdi ve bu alan modu belirlerdi. */
export function legacyModeFromEffort(effort: ThinkingLevel | undefined): ChatMode {
  return effort === 'high' ? 'deep' : effort === 'medium' ? 'balanced' : 'fast';
}
