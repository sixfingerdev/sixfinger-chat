import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, TerminalSquare } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';

type Phase = 'loading' | 'ready' | 'done' | 'invalid';

/** SixFinger Code CLI girişi: terminalde görünen kodu onayla. */
export function DevicePage() {
  const t = useT();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [client, setClient] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const guest = !user || user.isGuest;

  useEffect(() => {
    if (!code || guest) {
      setPhase(code ? 'ready' : 'invalid');
      return;
    }
    api
      .deviceInfo(code)
      .then((r) => {
        setClient(r.client);
        setPhase('ready');
      })
      .catch(() => setPhase('invalid'));
  }, [code, guest]);

  const approve = async () => {
    setBusy(true);
    try {
      await api.deviceApprove(code);
      setPhase('done');
    } catch {
      setPhase('invalid');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 440, margin: '12vh auto 0', padding: '0 20px', display: 'grid', gap: 16, textAlign: 'center', justifyItems: 'center' }}>
      <TerminalSquare size={36} strokeWidth={1.5} />
      <h1 style={{ fontSize: 22, margin: 0 }}>{t('device.title')}</h1>
      {phase === 'done' ? (
        <>
          <Check size={28} />
          <p style={{ margin: 0 }}>{t('device.done')}</p>
        </>
      ) : phase === 'invalid' ? (
        <>
          <p style={{ margin: 0 }}>{t('device.invalid')}</p>
          <input
            className="input"
            value={code}
            placeholder="ABCD-1234"
            maxLength={9}
            style={{ textAlign: 'center', letterSpacing: 2 }}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setPhase('loading');
            }}
          />
        </>
      ) : (
        <>
          <p style={{ margin: 0, opacity: 0.8 }}>{t('device.lead', { client: client || 'SixFinger Code' })}</p>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, letterSpacing: 4 }}>{code}</div>
          {guest ? (
            <button className="btn btn-primary" onClick={() => useUi.getState().openAuth('login')}>
              {t('device.signin')}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || phase === 'loading'} onClick={approve}>
              {t('device.approve')}
            </button>
          )}
          <p style={{ margin: 0, fontSize: 13, opacity: 0.65 }}>{t('device.hint')}</p>
        </>
      )}
    </div>
  );
}
