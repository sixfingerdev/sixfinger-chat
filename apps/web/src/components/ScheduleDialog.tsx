import { useState } from 'react';
import { SCHEDULE_LIMITS, computeNextRun, type ChatMode, type ScheduleSpec, type ScheduledTaskDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { Modal } from './Modal.tsx';

type Kind = ScheduleSpec['kind'];
type Unit = 'min' | 'hour' | 'day';

export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
};

/** datetime-local değeri (yerel saat) ↔ ISO. */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DAY_LABEL = { tr: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };

/** Zamanlanmış görev oluştur / düzenle penceresi. */
export function ScheduleDialog({ task, onClose, onDone }: { task?: ScheduledTaskDTO; onClose: () => void; onDone: (t: ScheduledTaskDTO) => void }) {
  const t = useT();
  const locale = useLocale();
  const sched = task?.schedule;
  const [title, setTitle] = useState(task?.title ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [mode, setMode] = useState<ChatMode>(task?.mode ?? 'balanced');
  const [kind, setKind] = useState<Kind>(sched?.kind ?? 'daily');
  const [time, setTime] = useState(sched && 'time' in sched ? sched.time : '09:00');
  const [days, setDays] = useState<number[]>(sched?.kind === 'weekly' ? sched.days : [1, 2, 3, 4, 5]);
  const initEvery = sched?.kind === 'interval' ? sched.minutes : 60;
  const [unit, setUnit] = useState<Unit>(initEvery % 1440 === 0 ? 'day' : initEvery % 60 === 0 ? 'hour' : 'min');
  const [every, setEvery] = useState(initEvery % 1440 === 0 ? initEvery / 1440 : initEvery % 60 === 0 ? initEvery / 60 : initEvery);
  const [at, setAt] = useState(sched?.kind === 'once' ? toLocalInput(sched.at) : toLocalInput(new Date(Date.now() + 3_600_000).toISOString()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tz = task?.timezone ?? browserTimezone();

  const minutes = every * (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1);
  const spec = (): ScheduleSpec | null => {
    if (kind === 'daily') return { kind, time };
    if (kind === 'weekly') return days.length ? { kind, days: [...days].sort(), time } : null;
    if (kind === 'interval') return { kind, minutes };
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? null : { kind, at: d.toISOString() };
  };
  const built = spec();
  const problem = !built
    ? ''
    : kind === 'interval' && minutes < SCHEDULE_LIMITS.minIntervalMinutes
      ? t('sched.minInterval')
      : !computeNextRun(built, tz, new Date())
        ? t('sched.pastTime')
        : '';
  const valid = Boolean(title.trim() && prompt.trim() && built && !problem);

  const submit = async () => {
    if (!built) return;
    setBusy(true);
    setError('');
    try {
      const body = { title: title.trim(), prompt: prompt.trim(), mode, schedule: built, timezone: tz };
      onDone(task ? (await api.scheduleUpdate(task.id, body)).task : (await api.scheduleCreate(body)).task);
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const kinds: Kind[] = ['daily', 'weekly', 'interval', 'once'];
  return (
    <Modal
      title={task ? t('sched.edit') : t('sched.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || !valid} onClick={() => void submit()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="field">
          <label htmlFor="sched-title">{t('sched.field.title')}</label>
          <input id="sched-title" className="input" value={title} maxLength={SCHEDULE_LIMITS.titleMax} placeholder={t('sched.field.titlePh')} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sched-prompt">{t('sched.field.prompt')}</label>
          <textarea id="sched-prompt" className="textarea" rows={4} value={prompt} maxLength={SCHEDULE_LIMITS.promptMax} placeholder={t('sched.field.promptPh')} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('sched.field.mode')}</label>
          <div className="segmented" role="group" aria-label={t('sched.field.mode')}>
            {(['fast', 'balanced', 'deep'] as const).map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`composer.mode.${m}` as 'composer.mode.fast')}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('sched.field.when')}</label>
          <div className="segmented" role="group" aria-label={t('sched.field.when')}>
            {kinds.map((k) => (
              <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(`sched.kind.${k}` as 'sched.kind.once')}
              </button>
            ))}
          </div>
        </div>
        {(kind === 'daily' || kind === 'weekly') && (
          <div className="field">
            <label htmlFor="sched-time">{t('sched.field.time')}</label>
            <input id="sched-time" className="input sched-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        {kind === 'weekly' && (
          <div className="field">
            <label>{t('sched.field.days')}</label>
            <div className="sched-days" role="group" aria-label={t('sched.field.days')}>
              {DAY_KEYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={clsx('sched-day', days.includes(d) && 'on')}
                  aria-pressed={days.includes(d)}
                  onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                >
                  {DAY_LABEL[locale][d - 1]}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind === 'interval' && (
          <div className="field">
            <label htmlFor="sched-every">{t('sched.field.every')}</label>
            <div className="sched-every">
              <input id="sched-every" className="input" type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label={t('sched.field.every')}>
                <option value="min">{t('sched.unit.min')}</option>
                <option value="hour">{t('sched.unit.hour')}</option>
                <option value="day">{t('sched.unit.day')}</option>
              </select>
            </div>
          </div>
        )}
        {kind === 'once' && (
          <div className="field">
            <label htmlFor="sched-at">{t('sched.field.at')}</label>
            <input id="sched-at" className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        {problem && <p className="field-error">{problem}</p>}
        {error && <p className="field-error">{error}</p>}
        <p className="hint">{t('sched.tz', { tz })}</p>
      </div>
    </Modal>
  );
}
