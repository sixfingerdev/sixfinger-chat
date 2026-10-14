import { useEffect, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  CircleUserRound,
  Database,
  Download,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Smartphone,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Settings2,
  Lock,
} from 'lucide-react';
import { PERSONAS, type MemoryDTO, type SessionDTO } from '@sixfinger/shared';
import { api, ApiError } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx, downloadFile, initials, timeUntil } from '../lib/format.ts';
import { setLocale, useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi, type SettingsTab, type ThemePref } from '../store/ui.ts';
import { Modal } from './Modal.tsx';
import { ServerForm } from './ServerForm.tsx';
import { isNative } from '../lib/native.ts';
import { getApiBase } from '../lib/api.ts';

function Row({ title, hint, children, stack }: { title: string; hint?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={clsx('set-row', stack && 'stack')}>
      <div className="set-row-text">
        <div className="set-row-title">{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Locked({ guest, onAction }: { guest: boolean; onAction: () => void }) {
  const t = useT();
  return (
    <div className="locked-note">
      <Lock size={16} />
      <span>{guest ? t('settings.guestLocked') : t('settings.memoryLocked')}</span>
      <button className="btn btn-accent btn-sm" onClick={onAction}>
        {guest ? t('limits.upgrade') : t('limits.verify')}
      </button>
    </div>
  );
}

function ServerRow() {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <Row title={t('server.current')} hint={getApiBase()} stack={editing}>
      {editing ? (
        <ServerForm onDone={() => window.location.reload()} />
      ) : (
        <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
          {t('server.change')}
        </button>
      )}
    </Row>
  );
}

function GeneralTab() {
  const t = useT();
  const locale = useLocale();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const config = useUi((s) => s.config);
  const user = useAuth((s) => s.user)!;

  const themes: Array<[ThemePref, string, ReactNode]> = [
    ['dark', t('settings.theme.dark'), <Moon size={14} key="d" />],
    ['light', t('settings.theme.light'), <Sun size={14} key="l" />],
    ['system', t('settings.theme.system'), <Monitor size={14} key="s" />],
  ];

  const changeLocale = async (l: 'tr' | 'en') => {
    setLocale(l);
    try {
      const { user: u } = await api.updateMe({ locale: l });
      useAuth.setState({ user: u });
    } catch {
      /* dil yerelde değişti, sorun değil */
    }
  };

  const used = config?.usage.used ?? 0;
  const limit = config?.usage.limit ?? 0;
  return (
    <div className="set-section">
      <Row title={t('settings.theme')}>
        <div className="segmented" role="group">
          {themes.map(([id, label, icon]) => (
            <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)}>
              {icon} {label}
            </button>
          ))}
        </div>
      </Row>
      <Row title={t('settings.language')}>
        <div className="segmented" role="group">
          <button aria-pressed={locale === 'tr'} onClick={() => void changeLocale('tr')}>
            Türkçe
          </button>
          <button aria-pressed={locale === 'en'} onClick={() => void changeLocale('en')}>
            English
          </button>
        </div>
      </Row>
      {isNative && <ServerRow />}
      <Row title={t('settings.plan')}>
        <span className={clsx('chip', user.tier === 'member' && 'success', user.tier === 'guest' && 'accent')}>
          {t(`settings.tier.${user.tier}` as 'settings.tier.guest')}
        </span>
      </Row>
      {config && (
        <Row title={t('settings.usageToday')} hint={t('settings.usageResets', { time: timeUntil(config.usage.resetsAt, locale) })} stack>
          <div className="usage big">
            <div className="usage-bar">
              <div className={clsx('usage-fill', used / limit >= 0.9 && 'hot')} style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
            </div>
            <span className="usage-text">
              {used} / {limit}
            </span>
          </div>
        </Row>
      )}
      <div className="kbd-grid">
        <span className="hint">⌘/Ctrl</span>
        <span>
          <span className="kbd">K</span> {t('palette.hint')}
        </span>
        <span className="hint">Enter</span>
        <span>{t('composer.send')}</span>
        <span className="hint">Shift + Enter</span>
        <span>↵</span>
        <span className="hint">Esc</span>
        <span>{t('composer.stop')}</span>
      </div>
    </div>
  );
}

function PersonalTab() {
  const t = useT();
  const locale = useLocale();
  const user = useAuth((s) => s.user)!;
  const features = useUi((s) => s.config?.limits.features);
  const [form, setForm] = useState(user.settings);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(user.settings);
  const locked = !features?.customInstructions;

  const save = async () => {
    setBusy(true);
    try {
      const { user: u } = await api.updateMe({
        settings: {
          customName: form.customName,
          about: form.about,
          instructions: form.instructions,
          defaultPersona: form.defaultPersona,
        },
      });
      useAuth.setState({ user: u });
      useUi.getState().toast({ kind: 'success', text: t('common.saved') });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-section">
      {locked && <Locked guest onAction={() => useUi.getState().openAuth('register')} />}
      <div className={clsx('field', locked && 'disabled')}>
        <label>{t('settings.name')}</label>
        <input className="input" disabled={locked} maxLength={60} value={form.customName} onChange={(e) => setForm({ ...form, customName: e.target.value })} placeholder={user.displayName} />
        <span className="hint">{t('settings.nameHint')}</span>
      </div>
      <div className={clsx('field', locked && 'disabled')}>
        <label>{t('settings.about')}</label>
        <textarea className="textarea" disabled={locked} maxLength={1000} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} placeholder={t('settings.aboutHint')} />
      </div>
      <div className={clsx('field', locked && 'disabled')}>
        <label>{t('settings.instructions')}</label>
        <textarea className="textarea" disabled={locked} maxLength={1500} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder={t('settings.instructionsHint')} />
        <span className="hint">{form.instructions.length}/1500</span>
      </div>
      <div className={clsx('field', locked && 'disabled')}>
        <label>{t('settings.defaultPersona')}</label>
        <select className="select" disabled={locked} value={form.defaultPersona} onChange={(e) => setForm({ ...form, defaultPersona: e.target.value })}>
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name[locale]} — {p.description[locale]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <button className="btn btn-primary" disabled={!dirty || busy || locked} onClick={() => void save()}>
          {busy ? <span className="spinner" /> : <Check size={16} />} {t('common.save')}
        </button>
      </div>
    </div>
  );
}

function MemoryTab() {
  const t = useT();
  const user = useAuth((s) => s.user)!;
  const features = useUi((s) => s.config?.limits.features);
  const [items, setItems] = useState<MemoryDTO[] | null>(null);
  const [text, setText] = useState('');
  const locked = !features?.memory;

  useEffect(() => {
    if (locked) return;
    api.memories().then((r) => setItems(r.memories)).catch(reportError);
  }, [locked]);

  const toggle = async () => {
    try {
      const { user: u } = await api.updateMe({ settings: { memoryEnabled: !user.settings.memoryEnabled } });
      useAuth.setState({ user: u });
    } catch (err) {
      reportError(err);
    }
  };

  if (locked) {
    return (
      <div className="set-section">
        <Locked
          guest={user.isGuest}
          onAction={() => useUi.getState().openAuth(user.isGuest ? 'register' : 'verify')}
        />
      </div>
    );
  }

  return (
    <div className="set-section">
      <Row title={t('settings.memoryOn')} hint={t('settings.memoryHint')}>
        <button className="switch" role="switch" aria-checked={user.settings.memoryEnabled} aria-label={t('settings.memoryOn')} onClick={() => void toggle()} />
      </Row>
      <form
        className="memory-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          try {
            const { memory } = await api.addMemory(text.trim());
            setItems((cur) => [memory, ...(cur ?? []).filter((m) => m.id !== memory.id)]);
            setText('');
          } catch (err) {
            reportError(err);
          }
        }}
      >
        <input className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={t('settings.memoryPlaceholder')} />
        <button className="btn btn-primary" disabled={!text.trim()}>
          <Plus size={16} /> {t('settings.memoryAdd')}
        </button>
      </form>
      {items && items.length === 0 && <p className="hint">{t('settings.memoryEmpty')}</p>}
      <ul className="memory-list">
        {(items ?? []).map((m) => (
          <li key={m.id}>
            <span>{m.content}</span>
            <button
              className="icon-btn sm"
              aria-label={t('common.delete')}
              onClick={async () => {
                try {
                  await api.deleteMemory(m.id);
                  setItems((cur) => (cur ?? []).filter((x) => x.id !== m.id));
                } catch (err) {
                  reportError(err);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      {items && items.length > 0 && (
        <button
          className="btn btn-danger btn-sm"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            try {
              await api.clearMemories();
              setItems([]);
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <Trash2 size={14} /> {t('settings.memoryClear')}
        </button>
      )}
    </div>
  );
}

function DataTab({ onClose }: { onClose: () => void }) {
  const t = useT();
  const features = useUi((s) => s.config?.limits.features);
  const user = useAuth((s) => s.user)!;
  const [busy, setBusy] = useState(false);

  return (
    <div className="set-section">
      <Row title={t('settings.exportAll')} hint={t('settings.exportAllHint')}>
        <button
          className="btn btn-outline"
          disabled={busy || !features?.exportAll}
          onClick={async () => {
            setBusy(true);
            try {
              downloadFile('sixfinger-export.json', JSON.stringify(await api.exportAll(), null, 2), 'application/json');
            } catch (err) {
              reportError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} /> JSON
        </button>
      </Row>
      <Row title={t('settings.deleteChats')} hint={t('settings.deleteChatsHint')}>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!window.confirm(t('settings.deleteChatsConfirm'))) return;
            try {
              await api.deleteAllChats();
              useChats.getState().reset();
              await useChats.getState().loadChats();
              useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
              onClose();
              window.location.assign('/');
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <Trash2 size={16} /> {t('common.delete')}
        </button>
      </Row>
      {!user.isGuest && <DeleteAccount />}
    </div>
  );
}

function DeleteAccount() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Row title={t('settings.deleteAccount')} hint={t('settings.deleteAccountHint')}>
        <button className="btn btn-danger" onClick={() => setOpen((o) => !o)}>
          {t('common.delete')}
        </button>
      </Row>
      {open && (
        <div className="field">
          <label>{t('settings.deleteAccountConfirm')}</label>
          <div className="share-row">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button
              className="btn btn-danger"
              disabled={!password}
              onClick={async () => {
                setErr(null);
                try {
                  await api.deleteMe(password);
                  await useAuth.getState().logout(true);
                  window.location.assign('/');
                } catch (e) {
                  setErr(e instanceof ApiError ? e.message : t('error.generic'));
                }
              }}
            >
              {t('common.confirm')}
            </button>
          </div>
          {err && <div className="form-error">{err}</div>}
        </div>
      )}
    </>
  );
}

function AccountTab({ onClose }: { onClose: () => void }) {
  const t = useT();
  const user = useAuth((s) => s.user)!;
  const [sessions, setSessions] = useState<SessionDTO[] | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user.isGuest) return;
    api.sessions().then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  }, [user.isGuest]);

  if (user.isGuest) {
    return (
      <div className="set-section">
        <div className="account-cta">
          <CircleUserRound size={34} />
          <h3>{t('auth.signUpTitle')}</h3>
          <p>{t('auth.signUpSub')}</p>
          <button className="btn btn-accent" onClick={() => { onClose(); useUi.getState().openAuth('register'); }}>
            {t('auth.signUp')}
          </button>
          <button className="btn btn-ghost" onClick={() => { onClose(); useUi.getState().openAuth('login'); }}>
            {t('auth.signIn')}
          </button>
        </div>
      </div>
    );
  }

  const deviceIcon = (ua: string | null) => (/android|iphone|mobile/i.test(ua ?? '') ? <Smartphone size={16} /> : <Laptop size={16} />);

  return (
    <div className="set-section">
      <div className="account-head">
        <span className="avatar lg">{initials(user.displayName)}</span>
        <div>
          <div className="set-row-title">{user.displayName}</div>
          <div className="hint">{user.email}</div>
        </div>
        {user.emailVerified ? (
          <span className="chip success">
            <Check size={12} /> {t('settings.verified')}
          </span>
        ) : (
          <button className="btn btn-accent btn-sm" onClick={() => { onClose(); useUi.getState().openAuth('verify'); }}>
            {t('limits.verify')}
          </button>
        )}
      </div>

      <form
        className="field"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.changePassword({ currentPassword: cur, newPassword: next });
            setCur('');
            setNext('');
            useUi.getState().toast({ kind: 'success', text: t('settings.passwordChanged') });
            api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
          } catch (err) {
            reportError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>{t('settings.changePassword')}</label>
        <input className="input" type="password" placeholder={t('settings.currentPassword')} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
        <input className="input" type="password" placeholder={t('settings.newPassword')} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        <div>
          <button className="btn btn-outline" disabled={busy || !cur || next.length < 8}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <div className="field">
        <label>{t('settings.sessions')}</label>
        <ul className="sessions">
          {(sessions ?? []).map((s) => (
            <li key={s.id}>
              {deviceIcon(s.userAgent)}
              <span className="sess-main">
                <span>{(s.userAgent ?? '—').replace(/\(.*?\)/g, '').slice(0, 48) || '—'}</span>
                <small>
                  {new Date(s.lastUsedAt).toLocaleString()} {s.current && <span className="chip accent">{t('settings.sessionCurrent')}</span>}
                </small>
              </span>
              {!s.current && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await api.revokeSession(s.id);
                      setSessions((l) => (l ?? []).filter((x) => x.id !== s.id));
                    } catch (err) {
                      reportError(err);
                    }
                  }}
                >
                  {t('settings.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <button className="btn btn-outline" onClick={async () => { onClose(); await useAuth.getState().logout(); }}>
          <LogOut size={16} /> {t('settings.signOut')}
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const tab = useUi((s) => s.settingsTab);
  const close = useUi((s) => s.closeSettings);
  const openSettings = useUi((s) => s.openSettings);
  const user = useAuth((s) => s.user);
  if (!tab || !user) return null;

  const tabs: Array<[SettingsTab, string, ReactNode]> = [
    ['general', t('settings.general'), <Settings2 size={16} key="g" />],
    ['personal', t('settings.personal'), <SlidersHorizontal size={16} key="p" />],
    ['memory', t('settings.memory'), <Brain size={16} key="m" />],
    ['data', t('settings.data'), <Database size={16} key="d" />],
    ['account', t('settings.account'), <UserRound size={16} key="a" />],
  ];

  return (
    <Modal title={t('settings.title')} onClose={close} wide className="settings-modal">
      <div className="settings">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {tabs.map(([id, label, icon]) => (
            <button key={id} className={clsx('settings-tab', tab === id && 'active')} onClick={() => openSettings(id)}>
              {icon} <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'general' && <GeneralTab />}
          {tab === 'personal' && <PersonalTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'data' && <DataTab onClose={close} />}
          {tab === 'account' && <AccountTab onClose={close} />}
        </div>
      </div>
    </Modal>
  );
}
