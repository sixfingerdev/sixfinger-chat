import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, Check } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useUi, type AuthMode } from '../store/ui.ts';
import { LogoMark, Wordmark } from './Logo.tsx';
import { Modal } from './Modal.tsx';

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        minLength={autoComplete === 'new-password' ? 8 : 1}
        maxLength={128}
      />
      <button type="button" className="icon-btn sm input-suffix" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide' : 'Show'} tabIndex={-1}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function AuthDialog() {
  const t = useT();
  const mode = useUi((s) => s.authMode);
  const closeAuth = useUi((s) => s.closeAuth);
  const smtpEnabled = useUi((s) => s.config?.smtpEnabled);
  const user = useAuth((s) => s.user);
  const [m, setM] = useState<AuthMode>(mode ?? 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (mode) {
      setM(mode);
      setError(null);
      setInfo(null);
      setCode('');
    }
  }, [mode]);

  // Doğrulama ekranı sonradan (afiş, ayarlar, uyarı) açılınca kimse kod göndermemiştir: kendiliğinden gönder. Az önce gönderildiyse (429) kalan beklemeyi göster.
  useEffect(() => {
    if (mode !== 'verify' || !user || user.isGuest || user.emailVerified) return;
    let alive = true;
    api
      .resendVerify()
      .then(() => alive && (setCooldown(45), setInfo(t('auth.resent'))))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 429) {
          setCooldown((err.details as { retryAfter?: number } | undefined)?.retryAfter ?? 45);
          setInfo(t('auth.resent'));
        } else setError(err instanceof ApiError ? err.message : t('error.generic'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1_000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (!mode) return null;
  const go = (next: AuthMode) => {
    setM(next);
    setError(null);
    setInfo(null);
  };
  const verifyEmail = user?.email ?? email;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const ui = useUi.getState();
      if (m === 'login') {
        await useAuth.getState().login(email, password);
        closeAuth();
      } else if (m === 'register') {
        await useAuth.getState().register({ email, password, displayName: name.trim() || undefined });
        setCooldown(45);
        setM('verify');
      } else if (m === 'verify') {
        const { user: u } = await api.verify(code);
        useAuth.getState().setUser(u);
        ui.toast({ kind: 'success', text: t('auth.verifyDone') });
        closeAuth();
      } else if (m === 'forgot') {
        await api.forgot(email);
        setCooldown(45);
        setM('reset');
      } else if (m === 'reset') {
        await api.reset({ email, code, password });
        setPassword('');
        setM('login');
        setInfo(t('auth.resetDone'));
      }
    });
  };

  const resend = () =>
    run(async () => {
      if (m === 'verify') await api.resendVerify();
      else await api.forgot(email);
      setCooldown(45);
      setInfo(t('auth.resent'));
    });

  const titles: Record<AuthMode, [string, string]> = {
    login: [t('auth.signInTitle'), t('auth.signInSub')],
    register: [t('auth.signUpTitle'), t('auth.signUpSub')],
    verify: [t('auth.verifyTitle'), t('auth.verifySub', { email: verifyEmail })],
    forgot: [t('auth.forgotTitle'), t('auth.forgotSub')],
    reset: [t('auth.resetTitle'), t('auth.resetSub', { email })],
  };
  const [title, sub] = titles[m];
  const needsCode = m === 'verify' || m === 'reset';

  return (
    <Modal onClose={closeAuth} hideHead wide className="auth-modal" title={title}>
      <div className="auth">
        <aside className="auth-aside" aria-hidden>
          <div className="auth-aside-top">
            <LogoMark size={22} />
            <Wordmark size={14} />
          </div>
          <LogoMark size={150} animate className="auth-big-mark" />
          <div className="auth-aside-copy">
            <h3>{t('auth.panelTitle')}</h3>
            <p>{t('auth.panelText')}</p>
            <ul>
              {(['auth.perk1', 'auth.perk2', 'auth.perk3', 'auth.perk4'] as const).map((k) => (
                <li key={k}>
                  <Check size={14} /> {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <form className="auth-form" onSubmit={onSubmit}>
          <div>
            <h2>{title}</h2>
            <p className="auth-sub">{sub}</p>
          </div>

          {info && (
            <div className="form-success">
              <Check size={16} /> {info}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              <CircleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /> {error}
            </div>
          )}

          {(m === 'login' || m === 'register' || m === 'forgot' || m === 'reset') && (
            <div className="field">
              <label htmlFor="auth-email">{t('auth.email')}</label>
              <input
                id="auth-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                readOnly={m === 'reset'}
                placeholder="ornek@eposta.com"
              />
            </div>
          )}
          {m === 'register' && (
            <div className="field">
              <label htmlFor="auth-name">{t('auth.name')}</label>
              <input id="auth-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
            </div>
          )}
          {needsCode && (
            <div className="field">
              <label htmlFor="auth-code">{t('auth.code')}</label>
              <input
                id="auth-code"
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                required
              />
              {smtpEnabled === false && <span className="hint">SMTP kapalı: kod sunucu loguna yazıldı.</span>}
            </div>
          )}
          {(m === 'login' || m === 'register' || m === 'reset') && (
            <div className="field">
              <label htmlFor="auth-pass">{m === 'login' ? t('auth.password') : t('auth.passwordNew')}</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder={m === 'login' ? t('auth.password') : t('auth.passwordNew')}
                autoComplete={m === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
          )}

          <button className="btn btn-accent btn-lg btn-block" type="submit" disabled={busy || (needsCode && code.length !== 6)}>
            {busy ? <span className="spinner" /> : null}
            {m === 'login' && t('auth.signIn')}
            {m === 'register' && t('auth.signUp')}
            {m === 'verify' && t('auth.verifyDo')}
            {m === 'forgot' && t('auth.sendCode')}
            {m === 'reset' && t('auth.resetDo')}
          </button>

          {needsCode && (
            <button type="button" className="link-btn center" disabled={busy || cooldown > 0} onClick={() => void resend()}>
              {cooldown > 0 ? t('auth.resendWait', { n: cooldown }) : t('auth.resend')}
            </button>
          )}

          <div className="auth-links">
            {m === 'login' && (
              <>
                <button type="button" className="link-btn" onClick={() => go('forgot')}>
                  {t('auth.forgot')}
                </button>
                <span>
                  {t('auth.noAccount')}{' '}
                  <button type="button" className="link-btn strong" onClick={() => go('register')}>
                    {t('auth.signUp')}
                  </button>
                </span>
              </>
            )}
            {m === 'register' && (
              <span>
                {t('auth.haveAccount')}{' '}
                <button type="button" className="link-btn strong" onClick={() => go('login')}>
                  {t('auth.signIn')}
                </button>
              </span>
            )}
            {(m === 'forgot' || m === 'reset') && (
              <button type="button" className="link-btn" onClick={() => go('login')}>
                {t('common.back')}
              </button>
            )}
            {m === 'verify' && (
              <button type="button" className="link-btn" onClick={closeAuth}>
                {t('auth.later')}
              </button>
            )}
          </div>

          {(m === 'login' || m === 'register') && user?.isGuest && (
            <p className="guest-note">{m === 'register' ? t('auth.guestLoses') : t('auth.guestNote')}</p>
          )}
          {(m === 'login' || m === 'register') && user?.isGuest && (
            <button type="button" className="btn btn-ghost btn-block" onClick={closeAuth}>
              {t('auth.guestContinue')}
            </button>
          )}
        </form>
      </div>
    </Modal>
  );
}
