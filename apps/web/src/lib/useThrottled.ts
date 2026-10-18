import { useEffect, useRef, useState } from 'react';

/** Değer çok sık değişirken (akış) en çok `ms` aralıkla günceller; etkin değilse anında. */
export function useThrottled<T>(value: T, ms: number, enabled: boolean): T {
  const [v, setV] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setV(value);
      return;
    }
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setV(value);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setV(value);
    }, wait);
    return () => clearTimeout(timer.current);
  }, [value, ms, enabled]);
  return v;
}
