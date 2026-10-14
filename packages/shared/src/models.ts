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
