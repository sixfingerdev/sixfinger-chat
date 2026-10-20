import { kv } from '../lib/storage.ts';

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
