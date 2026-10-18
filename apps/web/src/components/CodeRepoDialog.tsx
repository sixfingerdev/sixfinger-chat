import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GitBranch, Lock, Search } from 'lucide-react';
import type { GithubRepoDTO } from '@sixfinger/shared';
import { api, ApiError } from '../lib/api.ts';
import { clsx, timeAgo } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { Modal } from './Modal.tsx';

/** İki adımlı seçici: önce repo (arama), sonra taban branch. */
export function CodeRepoDialog({
  initialRepo,
  onPick,
  onClose,
}: {
  initialRepo?: string | null;
  onPick: (repo: string, baseBranch: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [step, setStep] = useState<'repo' | 'branch'>('repo');
  const [repos, setRepos] = useState<GithubRepoDTO[] | null>(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<GithubRepoDTO | null>(null);
  const [branches, setBranches] = useState<{ defaultBranch: string; branches: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();

  const fail = (err: unknown) => setError(err instanceof ApiError || err instanceof Error ? err.message : t('error.generic'));

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api
        .codeRepos(q.trim() || undefined)
        .then((r) => {
          setError(null);
          setRepos(r.repos);
        })
        .catch(fail);
    }, q ? 220 : 0);
    return () => window.clearTimeout(timer.current);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (r: GithubRepoDTO) => {
    setChosen(r);
    setStep('branch');
    setBranches(null);
    api.codeBranches(r.fullName).then(setBranches).catch(fail);
  };

  const sorted = useMemo(() => repos ?? [], [repos]);

  return (
    <Modal
      title={step === 'repo' ? t('code.repo.pick') : chosen?.fullName ?? ''}
      onClose={onClose}
      className="repo-dialog"
    >
      <div className="modal-body picker">
        {step === 'branch' && (
          <button className="btn btn-ghost btn-sm picker-back" onClick={() => setStep('repo')}>
            <ArrowLeft size={15} /> {t('code.repo')}
          </button>
        )}
        {step === 'repo' && (
          <div className="picker-search">
            <Search size={15} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('code.repo.search')} aria-label={t('code.repo.search')} autoFocus />
          </div>
        )}
        {error && <div className="form-error">{error}</div>}

        <div className="picker-list" role="listbox">
          {step === 'repo' && !repos && !error && [70, 54, 82, 60].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 16, margin: '14px 4px' }} />)}
          {step === 'repo' && repos && sorted.length === 0 && <div className="picker-empty">{t('code.repo.none')}</div>}
          {step === 'repo' &&
            sorted.map((r) => (
              <button key={r.fullName} role="option" aria-selected={r.fullName === initialRepo} className={clsx('picker-row', r.fullName === initialRepo && 'on')} onClick={() => choose(r)}>
                <span className="picker-main">
                  <span className="picker-name">
                    {r.fullName.split('/')[0]}
                    <i>/</i>
                    <b>{r.fullName.split('/')[1]}</b>
                    {r.private && (
                      <span className="chip-mini" title={t('code.repo.private')}>
                        <Lock size={11} /> {t('code.repo.private')}
                      </span>
                    )}
                  </span>
                  {r.description && <span className="picker-desc">{r.description}</span>}
                </span>
                {r.pushedAt && <span className="picker-meta">{timeAgo(r.pushedAt, locale)}</span>}
              </button>
            ))}

          {step === 'branch' && !branches && !error && [60, 74, 50].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 16, margin: '14px 4px' }} />)}
          {step === 'branch' &&
            branches?.branches.map((b) => (
              <button key={b} role="option" className="picker-row" onClick={() => chosen && onPick(chosen.fullName, b)}>
                <span className="picker-main">
                  <span className="picker-name">
                    <GitBranch size={14} /> <b>{b}</b>
                    {b === branches.defaultBranch && <span className="chip-mini">{t('code.branch.default')}</span>}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}
