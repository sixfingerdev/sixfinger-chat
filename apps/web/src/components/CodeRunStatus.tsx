import { useEffect, useState } from 'react';
import { pickStatusWord } from '@sixfinger/shared';
import { useLocale, useT } from '../lib/i18n/index.ts';
import type { CodeLive } from '../store/chats.ts';

/**
 * Ajan çalışırken composer'ın üstündeki durum çubuğu: nefes alan noktalar, geçen süre, çalışan görev sayısı ve dönen oyunlu kelime
 * ("Tinkering…", "Sixfingering…"). Sıra/hazırlık/commit/itme evrelerinde kelime yerine o evrenin adı yazılır.
 */
export function CodeRunStatus({ live, startedAt, runningTasks }: { live: CodeLive | undefined; startedAt: number; runningTasks: number }) {
  const t = useT();
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const [word, setWord] = useState(() => pickStatusWord(locale));

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const rotate = setInterval(() => setWord((w) => pickStatusWord(locale, w)), 3_400);
    return () => {
      clearInterval(tick);
      clearInterval(rotate);
    };
  }, [locale]);

  const phase = live?.phase;
  const label =
    phase === 'queued' ? (live?.position ? t('code.phase.queuedPos', { n: live.position }) : t('code.phase.queued')) : phase && phase !== 'working' ? t(`code.phase.${phase}`) : word;
  const secs = Math.max(0, Math.round((now - startedAt) / 1_000));
  const [um, us] = locale === 'tr' ? ['dk', 'sn'] : ['m', 's'];
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} ${um} ${secs % 60} ${us}` : t('code.status.sec', { s: secs });

  return (
    <div className="run-status" role="status" aria-live="off">
      <span className="run-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="run-elapsed">{elapsed}</span>
      {runningTasks > 0 && (
        <>
          <span className="run-sep">·</span>
          <span className="run-tasks">{t(runningTasks > 1 ? 'code.status.tasksMany' : 'code.status.tasks', { n: runningTasks })}</span>
        </>
      )}
      <span className="run-sep">·</span>
      <span className="run-word" key={label}>
        {label}…
      </span>
    </div>
  );
}
