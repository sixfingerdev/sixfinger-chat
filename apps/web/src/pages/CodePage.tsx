import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Cloud, Code2, GitBranch, Github, Pin, Plus, Search } from 'lucide-react';
import type { CodeEnvironmentDTO, CodeSessionDTO } from '@sixfinger/shared';
import { clsx, timeAgo } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useCode } from '../store/code.ts';
import { useUi } from '../store/ui.ts';
import { CodeCredits } from '../components/CodeCredits.tsx';
import { CodeEnvDialog, formatDisk } from '../components/CodeEnvDialog.tsx';
import { CodeMascot } from '../components/CodeMascot.tsx';
import { CodeTopBar } from '../components/CodeTopBar.tsx';

export function SessionCard({ s }: { s: CodeSessionDTO }) {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  return (
    <button className="code-card" onClick={() => nav(`/code/s/${s.chatId}`)}>
      <span className="code-card-icon">
        <Code2 size={20} />
      </span>
      <span className="code-card-main">
        <span className="code-card-title">
          {s.pinned && <Pin size={12} className="code-card-pin" aria-label={t('code.session.pinned')} />}
          {s.title === 'Yeni oturum' ? t('code.session.untitled') : s.title}
        </span>
        <span className="code-card-sub">
          <Cloud size={13} /> {s.repo} <GitBranch size={13} /> {s.baseBranch}
        </span>
      </span>
      <span className="code-card-time">
        <i className={clsx('status-dot', s.status)} title={t(`code.session.status.${s.status}` as 'code.session.status.idle')} />
        {timeAgo(s.lastMessageAt ?? s.createdAt, locale)}
      </span>
      {s.preview && <span className="code-card-preview">{s.preview}</span>}
    </button>
  );
}

function Blocked({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="code-blocked">
      <CodeMascot size={96} />
      <h2>{title}</h2>
      <p>{hint}</p>
    </div>
  );
}

export function CodePage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = useCode((s) => s.status);
  const envs = useCode((s) => s.envs);
  const sessions = useCode((s) => s.sessions);
  const loadError = useCode((s) => s.loadError);
  const user = useAuth((s) => s.user);
  const archived = useCode((s) => s.archived);
  const [editing, setEditing] = useState<CodeEnvironmentDTO | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    void useCode.getState().refresh();
  }, []);

  // GitHub'dan dönüş: ?gh_code&gh_state (bağlantıyı bu oturumla tamamla) ya da ?github=error.
  // Kod adres çubuğunda ve geçmişte kalmasın diye önce temizlenir.
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const code = params.get('gh_code');
    const state = params.get('gh_state');
    const failed = params.get('github') === 'error';
    if (!code && !failed) return;
    setParams({}, { replace: true });
    const ui = useUi.getState();
    if (failed || !code || !state) return void ui.toast({ kind: 'error', text: t('code.github.error') });
    if (handled.current.has(state)) return; // StrictMode çift çalıştırma
    handled.current.add(state);
    void useCode
      .getState()
      .completeGithub(code, state)
      .then((ok) => ok && ui.toast({ kind: 'success', text: t('code.github.ok') }));
  }, [params, setParams, t]);

  useEffect(() => {
    if (showArchive) void useCode.getState().loadArchived();
  }, [showArchive]);

  const match = (list: CodeSessionDTO[] | null) => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((s) => !q || `${s.title} ${s.repo} ${s.preview ?? ''}`.toLowerCase().includes(q));
  };

  const disconnect = async () => {
    if (window.confirm(t('code.github.disconnectConfirm'))) await useCode.getState().disconnect();
  };

  let body;
  if (!status) {
    body = loadError ? <Blocked title={t('error.generic')} hint={loadError} /> : <div className="code-skeleton">{[88, 64, 74].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 84, borderRadius: 18 }} />)}</div>;
  } else if (!status.available) {
    body = <Blocked title={t('code.title')} hint={t('code.unavailable')} />;
  } else if (!status.allowed) {
    body = <Blocked title={t('code.notAllowed')} hint={user && !user.emailVerified ? t('code.verifyFirst') : t('code.notAllowedHint')} />;
  } else {
    body = (
      <>
        {!status.github ? (
          <section className="code-connect">
            <span className="code-connect-icon">
              <Github size={26} />
            </span>
            <div>
              <h2>{t('code.github.connect')}</h2>
              <p>{t('code.github.connectHint')}</p>
            </div>
            <button className="btn btn-primary" onClick={() => void useCode.getState().connect()}>
              <Github size={16} /> {t('code.github.connect')}
            </button>
          </section>
        ) : (
          <section className="code-account">
            <Github size={16} />
            <span>{t('code.github.connected', { login: status.github.login })}</span>
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
              {t('code.github.disconnect')}
            </button>
          </section>
        )}

        <section className="code-section">
          <h3>{t('code.environments')}</h3>
          <div className="code-env-row">
            {(envs ?? []).map((e) => (
              <button key={e.id} className="env-chip" onClick={() => setEditing(e)}>
                <strong>{e.name}</strong>
                <span>
                  {t(`code.env.network.${e.network}` as 'code.env.network.none')} · {formatDisk(e.diskMb)}
                </span>
              </button>
            ))}
            <button className="env-chip add" onClick={() => setEditing('new')}>
              <Plus size={15} /> {t('code.addEnvironment')}
            </button>
          </div>
        </section>

        <section className="code-section">
          <div className="code-section-head">
            <h3>{t('code.sessions')}</h3>
            <button className="btn btn-primary btn-sm" onClick={() => nav('/code/new')}>
              <Plus size={15} /> {t('code.newSession')}
            </button>
          </div>
          {sessions && sessions.length > 3 && (
            <label className="code-search">
              <Search size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('code.session.search')} aria-label={t('code.session.search')} />
            </label>
          )}
          {sessions === null && <div className="code-skeleton">{[88, 70].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 84, borderRadius: 18 }} />)}</div>}
          {sessions && sessions.length === 0 && (
            <div className="code-empty">
              <strong>{t('code.empty')}</strong>
              <span>{t('code.emptyHint')}</span>
            </div>
          )}
          {sessions && sessions.length > 0 && match(sessions).length === 0 && <p className="code-muted">{t('code.session.noMatch')}</p>}
          <div className="code-cards">{match(sessions).map((s) => <SessionCard key={s.chatId} s={s} />)}</div>
          <button className="code-archive-toggle" onClick={() => setShowArchive((v) => !v)} aria-expanded={showArchive}>
            <Archive size={14} /> {t('code.session.archived')}
          </button>
          {showArchive && (
            <div className="code-cards">
              {archived && archived.length === 0 && <p className="code-muted">{t('code.session.archivedEmpty')}</p>}
              {match(archived).map((s) => <SessionCard key={s.chatId} s={s} />)}
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="code-page">
      <CodeTopBar title={t('code.title')} right={status?.allowed ? <CodeCredits compact /> : undefined} />
      <div className="code-scroll">
        <div className="code-inner">{body}</div>
      </div>
      {editing && <CodeEnvDialog env={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
