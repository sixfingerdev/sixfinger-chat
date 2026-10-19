import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronRight, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { SCHEDULE_LIMITS, describeSchedule, type ScheduledRunDTO, type ScheduledTaskDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx, timeAgo } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { Modal } from '../components/Modal.tsx';
import { ScheduleDialog } from '../components/ScheduleDialog.tsx';

const whenText = (iso: string, locale: 'tr' | 'en', tz: string) =>
  new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

/** Görev ayrıntısı: açma/kapama, şimdi çalıştır, düzenle, sil ve son çalışmaların sohbetleri. */
function TaskDialog({ task, onClose, onChange, onEdit, onGone }: { task: ScheduledTaskDTO; onClose: () => void; onChange: (t: ScheduledTaskDTO) => void; onEdit: () => void; onGone: () => void }) {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  const [runs, setRuns] = useState<ScheduledRunDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.scheduleRuns(task.id).then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, [task.id, task.lastRunAt]);

  const toggle = async () => {
    setBusy(true);
    try {
      onChange((await api.scheduleUpdate(task.id, { enabled: !task.enabled })).task);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      await api.scheduleRun(task.id);
      useUi.getState().toast({ kind: 'info', text: t('sched.run.started') });
      // Sonuç birkaç saniye içinde gelir: sohbet listesini ve görevi tazele.
      setTimeout(() => {
        void useChats.getState().loadChats();
        api.schedules().then((r) => {
          const fresh = r.tasks.find((x) => x.id === task.id);
          if (fresh) onChange(fresh);
        }).catch(() => {});
      }, 6_000);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(t('sched.deleteConfirm'))) return;
    try {
      await api.scheduleDelete(task.id);
      useUi.getState().toast({ kind: 'success', text: t('sched.deleted') });
      onGone();
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <Modal title={task.title} onClose={onClose}>
      <div className="modal-body">
        <p className="muted">{describeSchedule(task.schedule, locale, task.timezone)}</p>
        <p className="sched-prompt">{task.prompt}</p>
        <div className="switch-row">
          <span className="switch-text">
            <strong>{task.enabled ? (task.nextRunAt ? t('sched.next', { when: whenText(task.nextRunAt, locale, task.timezone) }) : t('sched.status.skipped')) : t('sched.off')}</strong>
            {task.source === 'agent' && <span className="hint">{t('sched.byAgent')}</span>}
          </span>
          <button className="switch" role="switch" aria-checked={task.enabled} aria-label={t('sched.off')} disabled={busy} onClick={() => void toggle()} />
        </div>
        <div className="sched-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run()}>
            <Play size={14} /> {t('sched.run')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Pencil size={14} /> {t('sched.edit')}
          </button>
          <button className="btn btn-ghost btn-sm danger" onClick={() => void remove()}>
            <Trash2 size={14} /> {t('common.delete')}
          </button>
        </div>
        {task.lastError && <p className="field-error">{task.lastError}</p>}
        <h4 className="sched-h">{t('sched.history')}</h4>
        {runs === null ? (
          <div className="skeleton" style={{ height: 44, borderRadius: 12 }} />
        ) : runs.length === 0 ? (
          <p className="muted">{t('sched.never')}</p>
        ) : (
          <ul className="skill-list">
            {runs.map((r) => (
              <li key={r.chatId}>
                <button
                  className="skill-row"
                  onClick={() => {
                    onClose();
                    nav(`/c/${r.chatId}`);
                  }}
                >
                  <span className="skill-main">
                    <strong>{r.title}</strong>
                    <span>{timeAgo(r.at, locale)}</span>
                  </span>
                  <ChevronRight size={15} className="code-row-go" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Zamanlanmış görevler: kendin kur ya da asistana söyle; sonuçlar yeni sohbet olarak gelir. */
export function ScheduledPage() {
  const t = useT();
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const guest = Boolean(user?.isGuest);
  const [tasks, setTasks] = useState<ScheduledTaskDTO[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ task?: ScheduledTaskDTO } | null>(null);

  useEffect(() => {
    if (guest) return setTasks([]);
    api.schedules().then((r) => setTasks(r.tasks)).catch((err) => {
      setTasks([]);
      reportError(err);
    });
  }, [guest]);

  const upsert = (x: ScheduledTaskDTO) => setTasks((cur) => (cur ? (cur.some((y) => y.id === x.id) ? cur.map((y) => (y.id === x.id ? x : y)) : [x, ...cur]) : [x]));
  const current = tasks?.find((x) => x.id === open) ?? null;
  const limitReached = (tasks?.length ?? 0) >= SCHEDULE_LIMITS.tasks;

  return (
    <div className="code-page">
      <CodeTopBar
        title={<><CalendarClock size={15} /> {t('sched.title')}</>}
        right={
          !guest && (
            <button className="btn btn-primary btn-sm" disabled={limitReached} onClick={() => setForm({})}>
              <Plus size={14} /> {t('sched.new')}
            </button>
          )
        }
      />
      <div className="code-scroll">
        <div className="code-inner">
          <p className="muted">{t('sched.subtitle')}</p>
          {guest ? (
            <p className="muted">{t('sched.guest')}</p>
          ) : tasks === null ? (
            <div className="skeleton" style={{ height: 72, borderRadius: 16 }} />
          ) : tasks.length === 0 ? (
            <div className="sched-empty">
              <CalendarClock size={28} />
              <p>{t('sched.empty')}</p>
              <button className="btn btn-primary" onClick={() => setForm({})}>
                <Plus size={15} /> {t('sched.new')}
              </button>
            </div>
          ) : (
            <ul className="skill-list">
              {tasks.map((x) => (
                <li key={x.id}>
                  <button className={clsx('skill-row', !x.enabled && 'sched-off')} onClick={() => setOpen(x.id)}>
                    <span className="skill-icon">
                      <CalendarClock size={16} />
                    </span>
                    <span className="skill-main">
                      <strong className="mcp-row-title">
                        {x.title}
                        {!x.enabled && <span className="mcp-chip off">{t('sched.off')}</span>}
                        {x.lastStatus === 'error' && <span className="mcp-chip error">{t('sched.status.error')}</span>}
                      </strong>
                      <span>
                        {describeSchedule(x.schedule, locale, x.timezone)}
                        {x.nextRunAt ? ` · ${t('sched.next', { when: whenText(x.nextRunAt, locale, x.timezone) })}` : ''}
                      </span>
                    </span>
                    <ChevronRight size={15} className="code-row-go" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {limitReached && <p className="hint">{t('sched.limit', { n: SCHEDULE_LIMITS.tasks })}</p>}
        </div>
      </div>
      {current && !form && (
        <TaskDialog
          task={current}
          onClose={() => setOpen(null)}
          onChange={upsert}
          onEdit={() => setForm({ task: current })}
          onGone={() => {
            setTasks((cur) => (cur ?? []).filter((y) => y.id !== current.id));
            setOpen(null);
          }}
        />
      )}
      {form && (
        <ScheduleDialog
          task={form.task}
          onClose={() => setForm(null)}
          onDone={(x) => {
            upsert(x);
            setForm(null);
            useUi.getState().toast({ kind: 'success', text: t('sched.saved') });
          }}
        />
      )}
    </div>
  );
}
