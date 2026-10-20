import { getLocales } from 'expo-localization';
import { langBase } from '@sixfinger/shared';
import { kv } from '../lib/storage.ts';
import { getLocale } from '../lib/i18n/index.ts';

/** Yanıtları sesli okuma: `auto` = yalnızca sesle sorulduysa. */
export type SpeakPref = 'auto' | 'on' | 'off';

export const readSpeakPref = (): SpeakPref => {
  const v = kv.get('sf.assist.speak');
  return v === 'on' || v === 'off' ? v : 'auto';
};

export const writeSpeakPref = (v: SpeakPref): void => kv.set('sf.assist.speak', v);

/** Güç tuşu / asistan kaydırmasıyla açılınca mikrofonu hemen aç (varsayılan: açık). */
export const readAutoVoice = (): boolean => kv.get('sf.assist.voice') !== 'off';
export const writeAutoVoice = (v: boolean): void => kv.set('sf.assist.voice', v ? 'on' : 'off');

/** Seçilebilecek konuşma dilleri (kendi adlarıyla) ve tanıyıcıya verilecek varsayılan etiket. */
export const SPEECH_LANGUAGES: Array<{ tag: string; name: string }> = [
  { tag: 'tr-TR', name: 'Türkçe' },
  { tag: 'en-US', name: 'English' },
  { tag: 'it-IT', name: 'Italiano' },
  { tag: 'de-DE', name: 'Deutsch' },
  { tag: 'fr-FR', name: 'Français' },
  { tag: 'es-ES', name: 'Español' },
  { tag: 'pt-BR', name: 'Português' },
  { tag: 'nl-NL', name: 'Nederlands' },
  { tag: 'pl-PL', name: 'Polski' },
  { tag: 'ru-RU', name: 'Русский' },
  { tag: 'ar-SA', name: 'العربية' },
  { tag: 'ja-JP', name: '日本語' },
  { tag: 'ko-KR', name: '한국어' },
  { tag: 'zh-CN', name: '中文' },
];
export const MAX_SPEECH_LANGS = 3;

/** Cihazın dil listesi (Ayarlar → Diller), sırasıyla; uygulama dili her zaman ilk adaydır. */
export function deviceSpeechLangs(): string[] {
  const out: string[] = [];
  const add = (tag: string | null | undefined) => {
    if (!tag) return;
    if (out.some((t) => langBase(t) === langBase(tag))) return;
    out.push(tag);
  };
  const app = getLocale();
  add(getLocales().find((l) => l.languageCode === app)?.languageTag ?? (app === 'tr' ? 'tr-TR' : 'en-US'));
  for (const l of getLocales()) add(l.languageTag);
  return out.slice(0, MAX_SPEECH_LANGS);
}

/** Asistanın dinlediği/okuduğu diller: kullanıcı seçtiyse o, yoksa cihaz dilleri. İlk dil birincildir. */
export function readSpeechLangs(): string[] {
  try {
    const raw = kv.get('sf.assist.langs');
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === 'string' && /^[a-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(x)).slice(0, MAX_SPEECH_LANGS);
      if (list.length > 0) return list;
    }
  } catch {
    // bozuk kayıt: varsayılana dön
  }
  return deviceSpeechLangs();
}
export const writeSpeechLangs = (langs: string[]): void => kv.set('sf.assist.langs', JSON.stringify(langs.slice(0, MAX_SPEECH_LANGS)));
