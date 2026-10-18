import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Check, Cloud, GitBranch, Layers, Sparkles } from 'lucide-react';
import { pickCodeGreeting } from '@sixfinger/shared';
import { clsx } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useCode } from '../store/code.ts';
import { CodeEnvDialog, formatDisk } from '../components/CodeEnvDialog.tsx';
import { CodeMascot } from '../components/CodeMascot.tsx';
import { CodeRepoDialog } from '../components/CodeRepoDialog.tsx';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { Popover } from '../components/Popover.tsx';

export function CodeNewPage() {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const status = useCode((s) => s.status);
  const envs = useCode((s) => s.envs);
  const draft = useCode((s) => s.draft);
  const [picker, setPicker] = useState(false);
  const [newEnv, setNewEnv] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void useCode.getState().refresh();
  }, []);

  const name = user && !user.isGuest ? user.settings.customName || user.displayName.split(' ')[0] : undefined;
  const now = useMemo(() => new Date(), []);
  const greeting = useMemo(
    () => pickCodeGreeting({ locale, name, hour: now.getHours(), day: now.getDay() }),
    [locale, name, now],
  );

  const env = envs?.find((e) => e.id === draft.environmentId) ?? envs?.[0];
  const ready = Boolean(draft.repo && draft.baseBranch && status?.github);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const start = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const s = await useCode.getState().createSession({
      repo: draft.repo!,
      baseBranch: draft.baseBranch!,
      environmentId: env?.id,
    });
    setBusy(false);
    if (s) nav(`/code/s/${s.chatId}`, { state: { firstPrompt: text.trim() || undefined } });
  };

  return (
    <div className="code-page">
      <CodeTopBar />
      <div className="code-new">
        <div className="code-new-hero">
          <CodeMascot size={118} />
          <h1>{greeting}</h1>
        </div>

        <div className="code-new-card">
          <div className="code-chips">
            <Popover
              direction="up"
              trigger={({ toggle, open }) => (
                <button className={clsx('code-chip', open && 'is-active')} onClick={toggle} aria-haspopup="menu" title={t('code.env')}>
                  <Layers size={15} /> {env?.name ?? t('code.env.pick')}
                </button>
              )}
            >
              {(close) => (
                <>
                  {(envs ?? []).map((e) => (
                    <button
                      key={e.id}
                      className="menu-item"
                      onClick={() => {
                        useCode.getState().setDraft({ environmentId: e.id });
                        close();
                      }}
                    >
                      {e.id === env?.id ? <Check size={16} /> : <span style={{ width: 16 }} />}
                      <span className="menu-two">
                        {e.name}
                        <small>
                          {t(`code.env.network.${e.network}` as 'code.env.network.none')} · {formatDisk(e.diskMb)}
                        </small>
                      </span>
                    </button>
                  ))}
                  <div className="menu-sep" />
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      setNewEnv(true);
                    }}
                  >
                    {t('code.addEnvironment')}
                  </button>
                </>
              )}
            </Popover>

            <button className={clsx('code-chip', !draft.repo && 'attention')} onClick={() => setPicker(true)} disabled={!status?.github} title={t('code.repo.pick')}>
              <Cloud size={15} />
              {draft.repo ? draft.repo.split('/')[1] : t('code.repo.pick')}
              {draft.baseBranch && (
                <>
                  <i className="chip-sep" />
                  <GitBranch size={14} /> {draft.baseBranch}
                </>
              )}
            </button>

            <Popover
              direction="up"
              align="end"
              className="chip-end"
              trigger={({ toggle, open }) => (
                <button className={clsx('code-chip', open && 'is-active')} onClick={toggle} aria-haspopup="menu">
                  <Sparkles size={15} /> {t('code.model')}
                </button>
              )}
            >
              {(close) => (
                <button className="menu-item" onClick={close}>
                  <Check size={16} />
                  <span className="menu-two">
                    {t('code.model')}
                    <small>{t('code.modelHint')}</small>
                  </span>
                </button>
              )}
            </Popover>
          </div>

          {!status?.github && status?.allowed && (
            <div className="code-warn">
              {t('code.github.connectHint')}{' '}
              <button className="link-btn" onClick={() => nav('/code')}>
                {t('code.github.connect')}
              </button>
            </div>
          )}

          <div className="composer code-composer">
            <textarea
              ref={area}
              className="composer-input"
              rows={1}
              value={text}
              placeholder={t('code.composer.placeholder')}
              onChange={(e) => {
                setText(e.target.value);
                grow();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !('ontouchstart' in window))) {
                  e.preventDefault();
                  void start();
                }
              }}
              aria-label={t('code.composer.placeholder')}
            />
            <div className="composer-bar">
              <span className="composer-note">{ready ? `${draft.repo} · ${draft.baseBranch}` : ''}</span>
              <button className="send-btn" onClick={() => void start()} disabled={!ready || busy} aria-label={t('code.start')} title={t('code.start')}>
                <ArrowUp size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <CodeRepoDialog
          initialRepo={draft.repo}
          onClose={() => setPicker(false)}
          onPick={(repo, baseBranch) => {
            useCode.getState().setDraft({ repo, baseBranch });
            setPicker(false);
          }}
        />
      )}
      {newEnv && <CodeEnvDialog env={null} onClose={() => setNewEnv(false)} />}
    </div>
  );
}
