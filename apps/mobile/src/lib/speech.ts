import * as Speech from 'expo-speech';

/** Markdown biçimlendirmesini sesli okuma için sadeleştirir. */
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

export function speak(text: string, lang: 'tr' | 'en', onEnd: () => void): void {
  void Speech.stop();
  Speech.speak(plainTextForSpeech(text), {
    language: lang === 'tr' ? 'tr-TR' : 'en-US',
    onDone: onEnd,
    onStopped: onEnd,
    onError: onEnd,
  });
}

export function stopSpeaking(): void {
  void Speech.stop();
}
