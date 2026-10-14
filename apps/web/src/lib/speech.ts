/** Tarayıcının konuşma API'leri: sesli okuma ve dikte. */

export const ttsSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

type SRConstructor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): SRConstructor | undefined {
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const dictationSupported = (): boolean => typeof window !== 'undefined' && Boolean(recognitionCtor());

export function plainTextForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/[#>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(text: string, lang: 'tr' | 'en', onEnd: () => void): void {
  if (!ttsSupported()) return onEnd();
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(plainTextForSpeech(text));
  u.lang = lang === 'tr' ? 'tr-TR' : 'en-US';
  u.onend = onEnd;
  u.onerror = onEnd;
  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (!ttsSupported()) return;
  currentUtterance = null;
  window.speechSynthesis.cancel();
}

export interface Dictation {
  stop: () => void;
}

export function startDictation(
  lang: 'tr' | 'en',
  handlers: { onText: (finalText: string, interim: string) => void; onEnd: () => void },
): Dictation | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang === 'tr' ? 'tr-TR' : 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (e) => {
    let finalText = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    handlers.onText(finalText, interim);
  };
  rec.onend = handlers.onEnd;
  rec.onerror = handlers.onEnd;
  try {
    rec.start();
  } catch {
    return null;
  }
  return { stop: () => rec.stop() };
}
