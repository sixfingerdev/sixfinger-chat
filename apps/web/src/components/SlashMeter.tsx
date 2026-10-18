import { clsx } from '../lib/format.ts';

/** Üç eğik çizgiden oluşan derinlik göstergesi: `level` kadarı dolu. Markanın eğik çizgi motifidir. */
export function SlashMeter({ level, className }: { level: 0 | 1 | 2 | 3; className?: string }) {
  return (
    <span className={clsx('slash-meter', className)} aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= level ? 'on' : undefined} />
      ))}
    </span>
  );
}
