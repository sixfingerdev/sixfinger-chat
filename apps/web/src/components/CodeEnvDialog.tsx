import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CodeEnvironmentDTO, CodeNetwork } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useCode } from '../store/code.ts';
import { useUi } from '../store/ui.ts';
import { Modal } from './Modal.tsx';

export const DISK_MIN = 128;
export const DISK_MAX = 1536;
export const DISK_STEP = 64;
const DISK_MARKS = [128, 512, 1024, 1536] as const;
export const formatDisk = (mb: number): string => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const NETWORKS: CodeNetwork[] = ['none', 'trusted', 'full', 'custom'];

function parseVars(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) return null;
    out[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

/** Ortam oluşturma / düzenleme penceresi. `env` boşsa yeni ortam. */
export function CodeEnvDialog({ env, onClose }: { env: CodeEnvironmentDTO | null; onClose: () => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState<CodeEnvironmentDTO | null>(env && env.envVars ? env : null);
  const [name, setName] = useState(env?.name ?? '');
  const [network, setNetwork] = useState<CodeNetwork>(env?.network ?? 'trusted');
  const [domains, setDomains] = useState((env?.allowedDomains ?? []).join('\n'));
  const [setup, setSetup] = useState(env?.setupScript ?? '');
  const [disk, setDisk] = useState<number>(env?.diskMb ?? 512);
  const [vars, setVars] = useState('');
  const [sessionLink, setSessionLink] = useState(env?.commitSessionLink ?? false);
  const [autoPr, setAutoPr] = useState(env?.autoPr ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Liste ortam değişkenlerini taşımaz; düzenlerken tek ortamı çekip doldur.
  useEffect(() => {
    if (!env || loaded) return;
    let off = false;
    api
      .codeEnv(env.id)
      .then(({ environment }) => {
        if (off) return;
        setLoaded(environment);
        setVars(Object.entries(environment.envVars ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
      })
      .catch(reportError);
    return () => {
      off = true;
    };
  }, [env, loaded]);

  const diskPct = useMemo(() => (Math.min(DISK_MAX, Math.max(DISK_MIN, disk)) - DISK_MIN) / (DISK_MAX - DISK_MIN), [disk]);
  const editingBlocked = Boolean(env) && !loaded;

  const save = async () => {
    const parsed = parseVars(vars);
    if (!parsed) return setError(t('code.env.varsInvalid'));
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    const saved = await useCode.getState().saveEnv(env?.id ?? null, {
      name: name.trim(),
      network,
      allowedDomains: network === 'custom' ? domains.split('\n').map((d) => d.trim()).filter(Boolean) : [],
      setupScript: setup,
      diskMb: disk,
      commitSessionLink: sessionLink,
      autoPr,
      envVars: parsed,
    });
    setBusy(false);
    if (saved) {
      useUi.getState().toast({ kind: 'success', text: t('code.env.saved') });
      onClose();
    }
  };

  const remove = async () => {
    if (!env || !window.confirm(t('code.env.deleteConfirm'))) return;
    setBusy(true);
    const ok = await useCode.getState().deleteEnv(env.id);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={env ? t('code.env.edit') : t('code.env.new')}
      onClose={onClose}
      wide
      footer={
        <>
          {env && (
            <button className="btn btn-ghost btn-danger-text" onClick={remove} disabled={busy}>
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || editingBlocked || !name.trim()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="modal-body env-form">
        <div className="field">
          <label htmlFor="env-name">{t('code.env.name')}</label>
          <input id="env-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Node 22" />
        </div>

        <div className="field">
          <span className="label">{t('code.env.network')}</span>
          <div className="net-options" role="radiogroup" aria-label={t('code.env.network')}>
            {NETWORKS.map((n) => (
              <button key={n} role="radio" aria-checked={network === n} className={clsx('net-option', network === n && 'on')} onClick={() => setNetwork(n)}>
                <strong>{t(`code.env.network.${n}` as 'code.env.network.none')}</strong>
                <span>{t(`code.env.network.${n}Hint` as 'code.env.network.noneHint')}</span>
              </button>
            ))}
          </div>
        </div>

        {network === 'custom' && (
          <div className="field">
            <label htmlFor="env-domains">{t('code.env.domains')}</label>
            <textarea id="env-domains" className="textarea mono" rows={4} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={'registry.npmjs.org\n*.github.com'} spellCheck={false} />
            <span className="hint">{t('code.env.domainsHint')}</span>
          </div>
        )}

        <div className="field">
          <div className="disk-head">
            <label htmlFor="env-disk">{t('code.env.disk')}</label>
            <b className="disk-value">{formatDisk(disk)}</b>
          </div>
          <div className="disk-slider" style={{ '--p': diskPct } as CSSProperties}>
            <input
              id="env-disk"
              type="range"
              className="disk-range"
              min={DISK_MIN}
              max={DISK_MAX}
              step={DISK_STEP}
              value={disk}
              onChange={(e) => setDisk(Number(e.target.value))}
              aria-valuetext={formatDisk(disk)}
            />
            <div className="disk-marks" aria-hidden>
              {DISK_MARKS.map((m) => (
                <span key={m} className={disk >= m ? 'on' : ''} style={{ '--p': (m - DISK_MIN) / (DISK_MAX - DISK_MIN) } as CSSProperties}>
                  <i />
                  <em>{formatDisk(m)}</em>
                </span>
              ))}
            </div>
          </div>
          <span className="hint">{t('code.env.diskHint')}</span>
        </div>

        <div className="field">
          <label htmlFor="env-setup">{t('code.env.setup')}</label>
          <textarea id="env-setup" className="textarea mono" rows={3} value={setup} maxLength={4000} onChange={(e) => setSetup(e.target.value)} placeholder="npm ci" spellCheck={false} />
          <span className="hint">{t('code.env.setupHint')}</span>
        </div>

        <div className="field">
          <span className="label">{t('code.env.attribution')}</span>
          <span className="hint">{t('code.env.attributionNote')}</span>
          <div className="switch-row">
            <span className="switch-text">
              <strong>{t('code.env.sessionLink')}</strong>
              <span className="hint">{t('code.env.sessionLinkHint')}</span>
            </span>
            <button className="switch" role="switch" aria-checked={sessionLink} aria-label={t('code.env.sessionLink')} onClick={() => setSessionLink(!sessionLink)} />
          </div>
        </div>

        <div className="field">
          <div className="switch-row">
            <span className="switch-text">
              <strong>{t('code.env.autoPr')}</strong>
              <span className="hint">{t('code.env.autoPrHint')}</span>
            </span>
            <button className="switch" role="switch" aria-checked={autoPr} aria-label={t('code.env.autoPr')} onClick={() => setAutoPr(!autoPr)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="env-vars">{t('code.env.vars')}</label>
          <textarea id="env-vars" className="textarea mono" rows={4} value={vars} onChange={(e) => setVars(e.target.value)} placeholder="API_URL=https://example.com" spellCheck={false} disabled={editingBlocked} />
          <span className="hint">{t('code.env.varsHint')}</span>
        </div>

        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}
