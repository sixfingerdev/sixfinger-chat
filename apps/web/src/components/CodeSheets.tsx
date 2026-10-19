import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, CircleAlert, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader } from 'lucide-react';
import type { CodeChangesDTO, CodePullDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { compactNumber, clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useCode } from '../store/code.ts';
import { CodeCredits } from './CodeCredits.tsx';
import { Modal } from './Modal.tsx';

/** Altta açılan (geniş ekranda ortada) küçük sayfa. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal title={title} onClose={onClose} className="sheet">
      <div className="modal-body sheet-body">{children}</div>
    </Modal>
  );
}

/** +N −M çifti. */
export function Delta({ add, del }: { add: number; del: number }) {
  return (
    <span className="delta">
      <span className="delta-add">+{compactNumber(add)}</span>
      <span className="delta-del">−{compactNumber(del)}</span>
    </span>
  );
}

/** Başlıktaki bağlam halkası: çevre çizgisi doluluğu gösterir. */
export function ContextRing({ tokens, limit, size = 22 }: { tokens: number; limit: number; size?: number }) {
  const ratio = limit > 0 ? Math.min(1, tokens / limit) : 0;
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className={clsx('ctx-ring', ratio >= 0.85 && 'hot')} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle className="ctx-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2.5" />
      <circle
        className="ctx-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * ratio} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function UsageSheet({ tokens, limit, onClose }: { tokens: number; limit: number; onClose: () => void }) {
  const t = useT();
  const pct = limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
  const hasCredits = useCode((s) => Boolean(s.status?.credits));
  return (
    <Sheet title={t('code.usage.title')} onClose={onClose}>
      <div className="usage-block">
        <div className="usage-row">
          <strong>{t('code.usage.context')}</strong>
          <span>{pct}%</span>
        </div>
        <div className="usage-bar big" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={clsx('usage-fill', pct >= 85 && 'hot')} style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">{t('code.usage.tokens', { used: compactNumber(tokens), limit: compactNumber(limit) })}</p>
        <p className="muted">{t('code.usage.hint')}</p>
      </div>
      {hasCredits && (
        <div className="usage-block">
          <div className="usage-row">
            <strong>{t('code.usage.credits')}</strong>
          </div>
          <CodeCredits bare />
        </div>
      )}
    </Sheet>
  );
}

const PR_ICON = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed } as const;

export function PullsSheet({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const t = useT();
  const [pulls, setPulls] = useState<CodePullDTO[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    api
      .codePulls(chatId)
      .then((r) => !off && setPulls(r.pulls))
      .catch((err) => {
        if (off) return;
        setFailed(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId]);

  return (
    <Sheet title={t('code.pr.title')} onClose={onClose}>
      {!pulls && !failed && <div className="skeleton" style={{ height: 56 }} />}
      {failed && (
        <div className="sheet-empty">
          <CircleAlert size={20} />
          <strong>{t('error.generic')}</strong>
        </div>
      )}
      {pulls && pulls.length === 0 && (
        <div className="sheet-empty">
          <GitPullRequest size={22} />
          <strong>{t('code.pr.none')}</strong>
          <p>{t('code.pr.noneHint')}</p>
        </div>
      )}
      {pulls?.map((p) => {
        const Icon = p.draft && p.state === 'open' ? GitPullRequestDraft : PR_ICON[p.state];
        return (
          <a key={p.number} className={clsx('pr-row', p.state)} href={p.url} target="_blank" rel="noreferrer">
            <Icon size={18} />
            <span className="pr-main">
              <strong>{p.title}</strong>
              <small>
                #{p.number} · {p.draft && p.state === 'open' ? t('code.pr.draft') : t(`code.pr.${p.state}`)} · {t('code.pr.files', { n: p.changedFiles })}
              </small>
            </span>
            <Delta add={p.additions} del={p.deletions} />
            <ArrowUpRight size={16} className="pr-go" aria-label={t('code.pr.github')} />
          </a>
        );
      })}
    </Sheet>
  );
}

const STATUS_KEY = { added: 'code.file.added', modified: 'code.file.modified', deleted: 'code.file.deleted', renamed: 'code.file.renamed' } as const;

export function ChangesSheet({ chatId, running, onClose }: { chatId: string; running: boolean; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<CodeChangesDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    api
      .codeChanges(chatId)
      .then((r) => !off && setData(r))
      .catch((err) => {
        if (off) return;
        setFailed(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId]);

  return (
    <Sheet title={t('code.changes')} onClose={onClose}>
      {!data && !failed && <div className="skeleton" style={{ height: 56 }} />}
      {failed && (
        <div className="sheet-empty">
          <CircleAlert size={20} />
          <strong>{t('error.generic')}</strong>
        </div>
      )}
      {data && (
        <>
          <div className="usage-row">
            <strong>{t('code.changes.files', { n: data.files.length || '—' })}</strong>
            <Delta add={data.additions} del={data.deletions} />
          </div>
          {data.files.length === 0 && (
            <p className="muted">{data.additions + data.deletions > 0 ? t('code.changes.stale') : t('code.changes.none')}</p>
          )}
          {data.files.length > 0 && (
            <ul className="change-list">
              {data.files.map((f) => (
                <li key={f.path}>
                  <span className="change-path" title={f.path}>
                    {f.path}
                  </span>
                  <span className="change-status">{t(STATUS_KEY[f.status])}</span>
                  <Delta add={f.additions} del={f.deletions} />
                </li>
              ))}
            </ul>
          )}
          {data.stale && data.files.length > 0 && <p className="muted">{t('code.changes.stale')}</p>}
          {running && data.stale && data.files.length === 0 && <Loader size={14} className="spin" />}
        </>
      )}
    </Sheet>
  );
}
