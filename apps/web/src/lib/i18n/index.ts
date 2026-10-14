import { useSyncExternalStore } from 'react';
import { tr, type DictKey } from './tr.ts';
import { en } from './en.ts';

export type Locale = 'tr' | 'en';
const dicts: Record<Locale, Record<DictKey, string>> = { tr, en };

const KEY = 'sf.locale';
let current: Locale = detect();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    /* yoksay */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* yoksay */
  }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn());
}

export function translate(key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[current][key] ?? tr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Bileşenlerde: `const t = useT()`. Dil değişince yeniden çizer. */
export function useT(): typeof translate {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return translate;
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export type { DictKey };
