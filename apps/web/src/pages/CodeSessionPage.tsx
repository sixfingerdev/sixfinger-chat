import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Cloud, Ellipsis, GitBranch, HardDrive, Layers, Trash2 } from 'lucide-react';
import type { CodeSessionDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useCode } from '../store/code.ts';
import { CodeMascot } from '../components/CodeMascot.tsx';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { Popover } from '../components/Popover.tsx';

/** Faz 1: oturum iskeleti. Çalıştırma (ajan) Faz 2'de gelecek; burada oturumun bağlamı ve hazır olduğu görünür. */
export function CodeSessionPage() {
  const t = useT();
  const nav = useNavigate();
  const { chatId } = useParams();
  const [session, setSession] = useState<CodeSessionDTO | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    setSession(null);
    setMissing(false);
    let off = false;
    api
      .codeSession(chatId)
      .then((r) => !off && setSession(r.session))
      .catch((err) => {
        if (off) return;
        setMissing(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId]);

  const remove = async () => {
    if (!session || !window.confirm(t('code.session.deleteConfirm'))) return;
    if (await useCode.getState().deleteSession(session.chatId)) nav('/code', { replace: true });
  };

  const title = session ? (session.title === 'Yeni oturum' ? t('code.session.untitled') : session.title) : '';

  return (
    <div className="code-page">
      <CodeTopBar
        title={title}
        subtitle={session ? `${session.repo}${session.environmentName ? ` · ${session.environmentName}` : ''}` : undefined}
        right={
          session && (
            <Popover
              align="end"
              trigger={({ toggle, open }) => (
                <button className={clsx('icon-btn', open && 'is-active')} onClick={toggle} aria-label="Menu" aria-haspopup="menu">
                  <Ellipsis size={18} />
                </button>
              )}
            >
              {(close) => (
                <button
                  className="menu-item danger"
                  onClick={() => {
                    close();
                    void remove();
                  }}
                >
                  <Trash2 size={16} /> {t('code.session.delete')}
                </button>
              )}
            </Popover>
          )
        }
      />
      <div className="code-scroll">
        <div className="code-inner session-skeleton">
          {!session && !missing && <div className="skeleton" style={{ width: '60%', height: 20 }} />}
          {missing && <div className="code-empty"><strong>{t('error.generic')}</strong></div>}
          {session && (
            <>
              <div className="session-soon">
                <CodeMascot size={84} />
                <p>{t('code.soon')}</p>
              </div>
              <dl className="session-facts">
                <div>
                  <dt>
                    <Cloud size={14} /> {t('code.repo')}
                  </dt>
                  <dd>{session.repo}</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch size={14} /> {t('code.branch.pick')}
                  </dt>
                  <dd>{session.baseBranch}</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch size={14} /> {t('code.branch.work')}
                  </dt>
                  <dd className="mono">{session.workBranch}</dd>
                </div>
                <div>
                  <dt>
                    <Layers size={14} /> {t('code.env')}
                  </dt>
                  <dd>{session.environmentName ?? '—'}</dd>
                </div>
                <div>
                  <dt>
                    <HardDrive size={14} /> {t('code.env.disk')}
                  </dt>
                  <dd>{session.diskUsedMb} MB</dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </div>
      <div className="composer-wrap">
        <div className="composer code-composer disabled">
          <textarea className="composer-input" rows={1} disabled placeholder={t('code.composer.placeholder')} />
          <div className="composer-bar">
            <span className="composer-note">{session ? `${session.repo.split('/')[1]}  ⎇ ${session.workBranch}` : ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
