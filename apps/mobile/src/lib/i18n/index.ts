import { useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { tr, en, type DictKey } from '@sixfinger/shared';
import { kv } from '../storage.ts';

export type Locale = 'tr' | 'en';
const dicts: Record<Locale, Record<DictKey, string>> = { tr, en };

const KEY = 'sf.locale';
const listeners = new Set<() => void>();
let current: Locale = 'tr';

/** Kayıtlı tercih varsa o, yoksa cihaz dili (Türkçe → tr, diğerleri → en). Depo yüklendikten sonra çağrılır. */
export function initLocale(): Locale {
  const saved = kv.get(KEY);
  if (saved === 'tr' || saved === 'en') {
    current = saved;
  } else {
    const device = getLocales()[0]?.languageCode?.toLowerCase();
    current = device === 'tr' ? 'tr' : 'en';
  }
  return current;
}

export function getLocale(): Locale {
  return current;
}

/** `remember`: kullanıcı elle seçtiyse true — bundan sonra cihaz dili yerine bu geçerli olur. */
export function setLocale(l: Locale, remember = false): void {
  if (remember) kv.set(KEY, l);
  if (l === current) return;
  current = l;
  listeners.forEach((fn) => fn());
}

export function translate(key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[current][key] ?? tr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Bileşenlerde: `const t = useT()`. Dil değişince yeniden çizer. */
export function useT(): typeof translate {
  useSyncExternalStore(subscribe, () => current);
  return translate;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current);
}

export type { DictKey };
