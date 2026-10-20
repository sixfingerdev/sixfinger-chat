import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
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

/**
 * Sesle sorma: cihazın konuşma tanıma servisi (yerel modül). Konuşma bitince `onFinal` çağrılır.
 * `level` (0–1) ses düzeyidir ve dalga göstergesini sürer.
 */
export function useSpeech(lang: string, onFinal: (text: string) => void, onError: (key: NonNullable<ReturnType<typeof errorKey>>) => void) {
  const [state, setState] = useState<SpeechState>('idle');
  const [partial, setPartial] = useState('');
  const level = useSharedValue(0);
  const finalRef = useRef(onFinal);
  const errorRef = useRef(onError);
  finalRef.current = onFinal;
  errorRef.current = onError;

  useEffect(() => {
    if (!assistantNative) return;
    const sub = assistantNative.addListener('onSpeech', (e) => {
      switch (e.type) {
        case 'ready':
          setState('listening');
          level.value = withTiming(0.12, { duration: 120 });
          break;
        case 'level':
          level.value = withTiming(Math.max(0.08, Math.min(1, (e.value + 2) / 12)), { duration: 90 });
          break;
        case 'partial':
          setPartial(e.text);
          break;
        case 'final':
          setState('idle');
          setPartial('');
          level.value = withTiming(0, { duration: 160 });
          if (e.text.trim()) finalRef.current(e.text.trim());
          else errorRef.current('assist.err.noSpeech');
          break;
        case 'error': {
          setState('idle');
          setPartial('');
          level.value = withTiming(0, { duration: 160 });
          const k = errorKey(e.code);
          if (k) errorRef.current(k);
          break;
        }
      }
    });
    return () => {
      sub.remove();
      assistantNative?.cancelListening();
    };
  }, [level]);

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
    setPartial('');
    setState('starting');
    assistantNative.startListening(lang);
  }, [lang]);

  const stop = useCallback(() => assistantNative?.stopListening(), []);
  const cancel = useCallback(() => {
    assistantNative?.cancelListening();
    setState('idle');
    setPartial('');
    level.value = withTiming(0, { duration: 120 });
  }, [level]);

  return { state, partial, level, start, stop, cancel };
}
