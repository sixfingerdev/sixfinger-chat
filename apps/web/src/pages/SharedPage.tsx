import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SharedChatDTO } from '@sixfinger/shared';
import { api, ApiError } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';
import { Brand, LogoMark } from '../components/Logo.tsx';
import { Md as Markdown } from '../components/MarkdownLazy.tsx';

export function SharedPage() {
  const t = useT();
  const { slug } = useParams();
  const [data, setData] = useState<SharedChatDTO | null>(null);
  const [error, setError] = useState<'notfound' | 'error' | null>(null);

  useEffect(() => {
    if (!slug) return;
    api
      .shared(slug)
      .then((d) => {
        setData(d);
        document.title = `${d.title} · SixFinger`;
      })
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'notfound' : 'error'));
  }, [slug]);

  return (
    <div className="shared-page">
      <header className="shared-head">
        <Link to="/" aria-label="SixFinger">
          <Brand size={20} />
        </Link>
        <Link className="btn btn-primary btn-sm" to="/">
          {t('share.cta')}
        </Link>
      </header>
      <main className="shared-main">
        {error && (
          <div className="thread-error">
            <LogoMark size={36} />
            <h2>{t('share.notFound')}</h2>
            <Link className="btn btn-primary" to="/">
              {t('share.continue')}
            </Link>
          </div>
        )}
        {!data && !error && <div className="skeleton" style={{ height: 24, width: '50%' }} />}
        {data && (
          <>
            <div className="shared-title">
              <span className="chip">{t('share.title')}</span>
              <h1>{data.title}</h1>
              <span className="hint">{new Date(data.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="shared-thread">
              {data.messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="msg msg-user">
                    <div className="bubble">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="msg msg-assistant">
                    <div className="msg-avatar" aria-hidden>
                      <LogoMark size={14} />
                    </div>
                    <div className="msg-main">
                      <Markdown text={m.content} />
                    </div>
                  </div>
                ),
              )}
            </div>
            <footer className="shared-foot">{t('share.by')}</footer>
          </>
        )}
      </main>
    </div>
  );
}
