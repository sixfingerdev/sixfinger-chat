import { useEffect, useState } from 'react';
import { ArrowUpRight, CircleAlert, GitPullRequest, Loader } from 'lucide-react';
import type { CodeDiffDTO, CodePrDraftDTO, CodePullDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { Delta, Sheet } from './CodeSheets.tsx';
import { DiffView } from './DiffView.tsx';
import { Modal } from './Modal.tsx';

/** Tüm farkı ya da tek dosyanın farkını gösteren geniş pencere. */
export function DiffSheet({ chatId, path, onClose }: { chatId: string; path?: string; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<CodeDiffDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    api
      .codeDiff(chatId, path)
      .then((r) => !off && setData(r))
      .catch((err) => {
        if (off) return;
        setFailed(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId, path]);

  return (
    <Modal title={path ?? t('code.diff.title')} onClose={onClose} wide className="sheet diff-modal">
      <div className="modal-body sheet-body">
        {!data && !failed && <div className="skeleton" style={{ height: 80 }} />}
        {failed && (
          <div className="sheet-empty">
            <CircleAlert size={20} />
            <strong>{t('error.generic')}</strong>
          </div>
        )}
        {data?.stale && <p className="muted">{t('code.diff.stale')}</p>}
        {data && !data.stale && <DiffView diff={data.diff} truncated={data.truncated} />}
      </div>
    </Modal>
  );
}

/** PR açma: model taslağı düzenlenir, "Gönder ve PR aç" kullanıcının açık onayıdır (push + PR birlikte). */
export function CreatePrSheet({ chatId, onClose, onDone }: { chatId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<CodePrDraftDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [asDraft, setAsDraft] = useState(false);
  const [busy, setBusy] = useState<'pr' | 'push' | null>(null);
  const [result, setResult] = useState<{ pull: CodePullDTO; existed: boolean } | null>(null);

  useEffect(() => {
    let off = false;
    api
      .codePrDraft(chatId)
      .then(({ draft: d }) => {
        if (off) return;
        setDraft(d);
        setTitle(d.title);
        setBody(d.body);
      })
      .catch((err) => {
        if (off) return;
        setFailed(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId]);

  const createPr = async () => {
    if (!title.trim() || busy) return;
    setBusy('pr');
    try {
      setResult(await api.codeCreatePr(chatId, { title: title.trim(), body, draft: asDraft }));
      onDone();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const pushOnly = async () => {
    if (busy) return;
    setBusy('push');
    try {
      await api.codePush(chatId);
      useUi.getState().toast({ kind: 'success', text: t('code.pr.pushed') });
      onDone();
      onClose();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const noCommits = Boolean(draft && draft.commits === 0 && !draft.needsPush);

  return (
    <Sheet title={t('code.pr.create')} onClose={onClose}>
      {!draft && !failed && (
        <div className="usage-row">
          <Loader size={14} className="spin" /> {t('code.pr.drafting')}
        </div>
      )}
      {failed && (
        <div className="sheet-empty">
          <CircleAlert size={20} />
          <strong>{t('error.generic')}</strong>
        </div>
      )}
      {result && (
        <div className="sheet-empty">
          <GitPullRequest size={22} />
          <strong>{result.existed ? t('code.pr.existed') : t('code.pr.created')}</strong>
          <p>
            #{result.pull.number} · {result.pull.title}
          </p>
          <a className="btn btn-primary" href={result.pull.url} target="_blank" rel="noreferrer">
            {t('code.pr.view')} <ArrowUpRight size={15} />
          </a>
        </div>
      )}
      {draft && !result && (
        <>
          <div className="usage-row">
            <span className="muted">
              {t('code.pr.summary', { n: draft.commits, files: draft.files })}
            </span>
            <Delta add={draft.additions} del={draft.deletions} />
          </div>
          {noCommits ? (
            <p className="muted">{t('code.pr.noCommits')}</p>
          ) : (
            <>
              <label className="field-label" htmlFor="pr-title">
                {t('code.pr.titleLabel')}
              </label>
              <input id="pr-title" className="input" value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} />
              <label className="field-label" htmlFor="pr-body">
                {t('code.pr.bodyLabel')}
              </label>
              <textarea id="pr-body" className="input pr-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
              <label className="switch-row">
                <span className="switch-text">
                  <strong>{t('code.pr.draftToggle')}</strong>
                </span>
                <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} />
              </label>
              <p className="muted">{t('code.pr.willPush', { head: draft.head, base: draft.base })}</p>
              <div className="pr-actions">
                <button className="btn btn-ghost" onClick={() => void pushOnly()} disabled={Boolean(busy) || !draft.needsPush}>
                  {busy === 'push' && <Loader size={14} className="spin" />} {t('code.pr.pushOnly')}
                </button>
                <button className="btn btn-primary" onClick={() => void createPr()} disabled={Boolean(busy) || !title.trim()}>
                  {busy === 'pr' && <Loader size={14} className="spin" />} {t('code.pr.createBtn')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
