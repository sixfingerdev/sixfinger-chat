import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useCode } from '../store/code.ts';

/** Günlük Code kredisi çubuğu (kenar çubuğunda ve ana ekranda). */
export function CodeCredits({ compact, bare }: { compact?: boolean; bare?: boolean }) {
  const t = useT();
  const credits = useCode((s) => s.status?.credits);
  if (!credits) return null;
  const pct = Math.min(100, Math.round((credits.used / credits.limit) * 100));
  const value = t('code.credits.value', { used: Math.floor(credits.used), limit: credits.limit });
  return (
    <div className={clsx('usage code-credits', compact && 'compact')} title={`${t('code.credits')}: ${value}`}>
      {!compact && !bare && <span className="usage-text">{t('code.credits')}</span>}
      <div className="usage-bar">
        <div className={clsx('usage-fill', pct >= 90 && 'hot')} style={{ width: `${pct}%` }} />
      </div>
      <span className="usage-text">{value}</span>
    </div>
  );
}
