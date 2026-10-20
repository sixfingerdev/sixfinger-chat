import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { chooseTranscript } from '@sixfinger/shared';
import { assistantNative } from './native.ts';

export type SpeechState = 'idle' | 'starting' | 'listening';

/** SpeechRecognizer hata kodu → kullanıcıya gösterilecek anahtar (null = sessizce yoksay). */
function errorKey(code: number): 'assist.err.noSpeech' | 'assist.err.permission' | 'assist.err.network' | 'assist.err.generic' | null {
  switch (code) {
    case 6: // SPEECH_TIMEOUT
    case 7: // NO_MATCH
      return 'assist.err.noSpeech';
    case 9:
      return 'assist.err.permission';
    case 1:
    case 2:
    case 4:
      return 'assist.err.network';
    case 8: // RECOGNIZER_BUSY
      return null;
    default:
      return 'assist.err.generic';
  }
}

type ErrKey = NonNullable<ReturnType<typeof errorKey>>;

/** Bir dilin tanıyıcısı ("şerit"): aynı sesi o dilde çözer. */
interface Lane {
  partial: string;
  final: string | null;
  confidence: number;
  /** Bitti: sonuç geldi ya da hata verdi. */
  done: boolean;
  error: number | null;
}

/** Bir sonuç geldikten sonra diğer dillerin sonuçlarını en çok bu kadar bekleriz. */
const SETTLE_MS = 1100;
/** Ses bittikten sonra hâlâ sonuç gelmeyen tanıyıcıları en çok bu kadar bekleriz. */
const AFTER_END_MS = 3500;
/** Çok dilli kipte bu sürede hiç yanıt (hazır/yazı/seviye) gelmezse tek dille cihaz mikrofonuna düşeriz. */
const NO_SIGNAL_MS = 4500;

/**
 * Sesle sorma: cihazın konuşma tanıma servisi (yerel modül). Birden çok dil seçiliyse AYNI ses her dil için ayrı bir tanıyıcıya verilir,
 * hepsi canlı yazı üretir; ekranda en olası dilin yazısı görünür, konuşma bitince güven puanı + metnin dili ile en iyisi seçilir.
 * `level` (0–1) ses düzeyidir ve dalga göstergesini sürer.
 */
export function useSpeech(getLangs: () => string[], onFinal: (text: string, lang: string) => void, onError: (key: ErrKey) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [partial, setPartial] = useState('');
  const level = useSharedValue(0);
  const finalRef = useRef(onFinal);
  const errorRef = useRef(onError);
  finalRef.current = onFinal;
  errorRef.current = onError;

  // oturum durumu (render dışı)
  const lanes = useRef(new Map<string, Lane>());
  const langs = useRef<string[]>([]);
  const multi = useRef(false);
  const live = useRef(false); // bir dinleme sürüyor
  const signal = useRef(false); // tanıyıcıdan en az bir olay geldi
  const triedSingle = useRef(false);
  const timers = useRef<{ settle?: ReturnType<typeof setTimeout>; after?: ReturnType<typeof setTimeout>; nosig?: ReturnType<typeof setTimeout> }>({});

  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.settle);
    clearTimeout(timers.current.after);
    clearTimeout(timers.current.nosig);
    timers.current = {};
  }, []);

  const idle = useCallback(() => {
    live.current = false;
    clearTimers();
    setState('idle');
    setPartial('');
    level.value = withTiming(0, { duration: 160 });
  }, [clearTimers, level]);

  /** Şeritlerden en iyi çıktıyı seçip bitirir. */
  const resolve = useCallback(() => {
    if (!live.current) return;
    const entries = [...lanes.current.entries()];
    const finals = entries.filter(([, l]) => l.final?.trim());
    const pool = finals.length > 0 ? finals.map(([lang, l]) => ({ lang, text: l.final!, confidence: l.confidence })) : entries.map(([lang, l]) => ({ lang, text: l.partial }));
    const best = chooseTranscript(pool, langs.current, langs.current[0] ?? 'en');
    assistantNative?.cancelListening();
    idle();
    if (best >= 0) {
      const c = pool[best]!;
      finalRef.current(c.text.trim(), c.lang);
      return;
    }
    // metin yok: hata kodlarından anlamlı olanı göster
    const codes = entries.map(([, l]) => l.error).filter((x): x is number => x !== null);
    const key = codes.map(errorKey).find((k) => k !== null && k !== 'assist.err.noSpeech') ?? 'assist.err.noSpeech';
    errorRef.current(key);
  }, [idle]);

  const showLeader = useCallback(() => {
    const entries = [...lanes.current.entries()];
    const pool = entries.map(([lang, l]) => ({ lang, text: l.partial }));
    const i = chooseTranscript(pool, langs.current, langs.current[0] ?? 'en');
    setPartial(i >= 0 ? pool[i]!.text : '');
  }, []);

  const checkDone = useCallback(() => {
    const all = [...lanes.current.values()];
    if (all.length > 0 && all.every((l) => l.done)) resolve();
  }, [resolve]);

  const begin = useCallback(
    (forceSingle: boolean) => {
      if (!assistantNative) return;
      clearTimers();
      lanes.current = new Map();
      live.current = true;
      signal.current = false;
      setPartial('');
      setState('starting');
      const list = langs.current;
      multi.current = !forceSingle && list.length > 1;
      assistantNative.startListening(forceSingle ? list.slice(0, 1) : list, forceSingle);
      if (!forceSingle && list.length > 1) {
        timers.current.nosig = setTimeout(() => {
          if (live.current && !signal.current && !triedSingle.current) {
            triedSingle.current = true;
            begin(true);
          }
        }, NO_SIGNAL_MS);
      }
    },
    [clearTimers],
  );

  useEffect(() => {
    if (!assistantNative) return;
    const sub = assistantNative.addListener('onSpeech', (e) => {
      if (!live.current) return;
      // tanıyıcıdan (kendi kaydımızdan değil) gelen ilk olay: çok dilli kip çalışıyor demektir
      if ('lang' in e && e.lang) signal.current = true;
      switch (e.type) {
        case 'lanes':
          lanes.current = new Map(e.langs.map((l) => [l, { partial: '', final: null, confidence: -1, done: false, error: null }]));
          multi.current = e.langs.length > 1;
          break;
        case 'ready':
          setState('listening');
          level.value = withTiming(0.12, { duration: 120 });
          break;
        case 'level':
          level.value = withTiming(Math.max(0.08, Math.min(1, (e.value + 2) / 12)), { duration: 90 });
          break;
        case 'partial': {
          const l = lanes.current.get(e.lang);
          if (l) l.partial = e.text;
          setState('listening');
          showLeader();
          break;
        }
        case 'final': {
          const l = lanes.current.get(e.lang);
          if (l) {
            l.final = e.text;
            l.confidence = e.confidence;
            l.done = true;
          }
          if (!multi.current) {
            resolve();
            break;
          }
          if (e.text.trim() && !timers.current.settle) timers.current.settle = setTimeout(resolve, SETTLE_MS);
          checkDone();
          break;
        }
        case 'error': {
          // oturumla ilgili (şeritsiz) hata
          const l = e.lang ? lanes.current.get(e.lang) : undefined;
          if (l) {
            l.done = true;
            l.error = e.code;
          }
          if (!multi.current || !l) {
            // tek dil ya da genel hata: sonuç yoksa hatayı göster
            if (!l && multi.current) lanes.current.forEach((x) => { x.done = true; x.error = e.code; });
            if (!l && !multi.current) lanes.current.set(e.lang ?? '', { partial: '', final: null, confidence: -1, done: true, error: e.code });
            resolve();
            break;
          }
          // çok dilli kip: bütün şeritler benign olmayan hatayla düştüyse (ör. cihaz harici sesi kabul etmiyor) tek dille yeniden dene
          const all = [...lanes.current.values()];
          if (all.every((x) => x.done) && all.every((x) => x.error !== null && x.error !== 6 && x.error !== 7) && !triedSingle.current && !all.some((x) => x.partial)) {
            triedSingle.current = true;
            assistantNative?.cancelListening();
            begin(true);
            break;
          }
          checkDone();
          break;
        }
        case 'end':
          // yalnızca ses bitti bildirimi (tek tek tanıyıcıların kendi bitişi değil)
          if (!e.lang && multi.current && !timers.current.after) timers.current.after = setTimeout(resolve, AFTER_END_MS);
          break;
      }
    });
    return () => {
      sub.remove();
      clearTimers();
      live.current = false;
      assistantNative?.cancelListening();
    };
  }, [level, resolve, checkDone, showLeader, begin, clearTimers]);

  const start = useCallback(async () => {
    if (!assistantNative) return;
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      errorRef.current('assist.err.permission');
      return;
    }
    if (!assistantNative.isSpeechAvailable()) {
      errorRef.current('assist.err.generic');
      return;
    }
    langs.current = getLangs();
    triedSingle.current = false;
    begin(false);
  }, [begin, getLangs]);

  const stop = useCallback(() => assistantNative?.stopListening(), []);
  const cancel = useCallback(() => {
    assistantNative?.cancelListening();
    idle();
  }, [idle]);

  return { state, partial, level, start, stop, cancel };
}
