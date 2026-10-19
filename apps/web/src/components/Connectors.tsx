import { useState } from 'react';
import { Check, ChevronRight, Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { MCP_LIMITS, fillPresetUrl, mcpHost, type McpPresetView, type McpScope, type McpServerDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { Modal } from './Modal.tsx';

export type McpStatus = 'ok' | 'auth' | 'error' | 'off';

/** Satırdaki durum çipi: kapalı, yetki gerekiyor, hata ya da kaç araç var. */
export function statusOf(s: McpServerDTO): McpStatus {
  if (!s.enabled) return 'off';
  if (s.lastError === 'authorization_required' || (s.authKind === 'oauth' && !s.connected)) return 'auth';
  if (s.lastError) return 'error';
  return 'ok';
}

export function StatusChip({ server }: { server: McpServerDTO }) {
  const t = useT();
  const st = statusOf(server);
  const text = st === 'off' ? t('mcp.status.off') : st === 'auth' ? t('mcp.status.needsAuth') : st === 'error' ? t('mcp.status.error') : t('mcp.status.ok', { n: server.tools.length });
  return <span className={`mcp-chip ${st}`}>{text}</span>;
}

/** Tek renkli kare harf avatarı (katalog ve satırlar). */
export function Avatar({ label }: { label: string }) {
  return (
    <span className="mcp-avatar" aria-hidden>
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

const AUTH_REQUIRED = 'authorization_required';

/** OAuth'u başlatır: tarayıcıyı yetkilendirme sayfasına götürür (zaten yetkiliyse yeni durumu döndürür). */
export async function startConnect(server: McpServerDTO): Promise<McpServerDTO | null> {
  const r = await api.mcpConnect(server.id, 'web');
  if (r.authorizeUrl) {
    window.location.assign(r.authorizeUrl);
    return null;
  }
  return r.server;
}

// ------------------------------------------------------------------------------------------------ katalog kartı
export function PresetCard({
  preset,
  server,
  onConnect,
  onOpen,
  busy,
}: {
  preset: McpPresetView;
  server: McpServerDTO | undefined;
  onConnect: (p: McpPresetView) => void;
  onOpen: (s: McpServerDTO) => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const connected = server ? statusOf(server) === 'ok' : false;
  const note = !preset.available ? (preset.reason === 'admin' ? t('mcp.needsAdmin') : t('mcp.soon')) : null;
  return (
    <li className={`mcp-card${preset.available ? '' : ' disabled'}`}>
      <div className="mcp-card-top">
        <Avatar label={preset.label} />
        <div className="mcp-card-title">
          <strong>
            {preset.label}
            {preset.interactive && <em className="mcp-tag">{t('mcp.interactive')}</em>}
          </strong>
          <span className="mcp-rank">{t('mcp.popular', { n: preset.rank })}</span>
        </div>
        {server ? (
          <button className="btn btn-ghost btn-sm" onClick={() => (connected ? onOpen(server) : onConnect(preset))} disabled={busy}>
            {connected ? (
              <>
                <Check size={14} /> {t('mcp.connected')}
              </>
            ) : (
              t('mcp.connect')
            )}
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => onConnect(preset)} disabled={!preset.available || busy}>
            {note ?? t('mcp.connect')}
          </button>
        )}
      </div>
      <p className="mcp-card-desc">{preset.description[locale]}</p>
      {preset.status === 'verify' && preset.available && !server && <p className="mcp-card-note">{t('mcp.unverified')}</p>}
      {preset.note && preset.available && !server && <p className="mcp-card-note">{preset.note[locale]}</p>}
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ eklenmiş sunucu satırı
export function ServerRow({ server, onOpen }: { server: McpServerDTO; onOpen: (s: McpServerDTO) => void }) {
  return (
    <li>
      <button className="skill-row" onClick={() => onOpen(server)}>
        <Avatar label={server.label} />
        <span className="skill-main">
          <strong className="mcp-row-title">
            {server.label}
            <StatusChip server={server} />
          </strong>
          <span>{mcpHost(server.url)}</span>
        </span>
        <ChevronRight size={15} className="code-row-go" />
      </button>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ hazır kart için ek bilgi (değişken / anahtar)
export function PresetDialog({
  preset,
  onClose,
  onDone,
}: {
  preset: McpPresetView;
  onClose: () => void;
  /** Sunucu oluşturuldu (OAuth ise ardından yetkilendirmeye gidilir). */
  onDone: (s: McpServerDTO | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [values, setValues] = useState<Record<string, string>>({});
  const [useToken, setUseToken] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = fillPresetUrl(preset, values);
  const ready = Boolean(url) && (!useToken || token.trim().length > 0);

  const submit = async () => {
    if (!url) return;
    setBusy(true);
    setError('');
    try {
      const headers = useToken && preset.token ? { [preset.token.header]: `${preset.token.prefix ?? ''}${token.trim()}` } : undefined;
      const { server } = await api.mcpCreate({ label: preset.label, url, preset: preset.id, headers });
      if (!headers && server.authKind === 'oauth') {
        useUi.getState().toast({ kind: 'info', text: t('mcp.connecting') });
        onDone(await startConnect(server));
      } else onDone(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.connectFailed'));
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={preset.label}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? t('mcp.adding') : useToken ? t('mcp.add') : preset.auth === 'none' ? t('mcp.add') : t('mcp.connect')}
          </button>
        </>
      }
    >
      <div className="modal-body">
      <p className="muted">{preset.description[locale]}</p>
      {preset.note && <p className="mcp-card-note">{preset.note[locale]}</p>}
      {(preset.variables ?? []).map((v) => (
        <div className="field" key={v.key}>
          <label htmlFor={`mcp-var-${v.key}`}>{v.label[locale]}</label>
          <input id={`mcp-var-${v.key}`} className="input" value={values[v.key] ?? ''} placeholder={v.placeholder} autoCapitalize="none" autoCorrect="off" onChange={(e) => setValues((x) => ({ ...x, [v.key]: e.target.value }))} />
        </div>
      ))}
      {preset.token && (
        <>
          <div className="mcp-choice" role="radiogroup">
            <button role="radio" aria-checked={!useToken} className={!useToken ? 'on' : ''} onClick={() => setUseToken(false)}>
              {t('mcp.useOauth')}
            </button>
            <button role="radio" aria-checked={useToken} className={useToken ? 'on' : ''} onClick={() => setUseToken(true)}>
              {t('mcp.useToken')}
            </button>
          </div>
          {useToken && (
            <div className="field">
              <label htmlFor="mcp-token">{preset.token.label[locale]}</label>
              <input id="mcp-token" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
              {preset.token.hint && <span className="hint">{preset.token.hint[locale]}</span>}
            </div>
          )}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ özel sunucu ekle / düzenle
interface HeaderRow {
  name: string;
  value: string;
  /** Sunucuda kayıtlı (değeri bilmiyoruz). */
  saved: boolean;
}

export function CustomDialog({ server, onClose, onDone }: { server?: McpServerDTO; onClose: () => void; onDone: (s: McpServerDTO) => void }) {
  const t = useT();
  const [label, setLabel] = useState(server?.label ?? '');
  const [url, setUrl] = useState(server?.url ?? 'https://');
  const [rows, setRows] = useState<HeaderRow[]>((server?.headerNames ?? []).map((name) => ({ name, value: '', saved: true })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const touched = rows.some((r) => !r.saved || r.value);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const filled = rows.filter((r) => r.name.trim() && (r.value || r.saved));
      // Değeri girilmemiş kayıtlı başlıklar korunamaz (değerler sunucudan gelmez): yeni liste tamamen değiştirir.
      const headers = Object.fromEntries(filled.filter((r) => r.value).map((r) => [r.name.trim(), r.value]));
      if (server) {
        const body: Parameters<typeof api.mcpUpdate>[1] = { label: label.trim(), url: url.trim() };
        if (touched) body.headers = headers;
        onDone((await api.mcpUpdate(server.id, body)).server);
      } else {
        onDone((await api.mcpCreate({ label: label.trim(), url: url.trim(), headers: Object.keys(headers).length ? headers : undefined })).server);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.connectFailed'));
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('mcp.custom.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy || !label.trim() || !/^https:\/\/.+/.test(url.trim())} onClick={() => void submit()}>
            {busy ? t('mcp.adding') : server ? t('common.save') : t('mcp.add')}
          </button>
        </>
      }
    >
      <div className="modal-body">
      {!server && <p className="muted">{t('mcp.custom.hint')}</p>}
      <div className="field">
        <label htmlFor="mcp-label">{t('mcp.field.label')}</label>
        <input id="mcp-label" className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="mcp-url">{t('mcp.field.url')}</label>
        <input id="mcp-url" className="input mono" value={url} inputMode="url" autoCapitalize="none" autoCorrect="off" onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">{t('mcp.field.headers')}</span>
        {rows.map((r, i) => (
          <div className="mcp-header-row" key={i}>
            <input className="input mono" value={r.name} placeholder={t('mcp.field.headerName')} aria-label={t('mcp.field.headerName')} autoCapitalize="none" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value, saved: false } : y)))} />
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              value={r.value}
              placeholder={r.saved ? t('mcp.headerSaved') : t('mcp.field.headerValue')}
              aria-label={t('mcp.field.headerValue')}
              onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))}
            />
            <button className="icon-btn" aria-label={t('mcp.remove')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
              <X size={15} />
            </button>
          </div>
        ))}
        {rows.length < MCP_LIMITS.headers && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRows((x) => [...x, { name: '', value: '', saved: false }])}>
            <Plus size={14} /> {t('mcp.addHeader')}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ sunucu ayrıntısı
export function ServerDialog({ server, onClose, onChanged, onRemoved }: { server: McpServerDTO; onClose: () => void; onChanged: (s: McpServerDTO) => void; onRemoved: (id: string) => void }) {
  const t = useT();
  const [s, setS] = useState(server);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [warn, setWarn] = useState(false);

  const apply = (next: McpServerDTO) => {
    setS(next);
    onChanged(next);
  };
  const run = async (fn: () => Promise<McpServerDTO | null>) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) apply(next);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: Parameters<typeof api.mcpUpdate>[1]) => run(async () => (await api.mcpUpdate(s.id, body)).server);

  const toggleScope = (sc: McpScope) => {
    const has = s.scopes.includes(sc);
    const next = has ? s.scopes.filter((x) => x !== sc) : [...s.scopes, sc];
    if (next.length) void patch({ scopes: next });
  };
  const toggleTool = (name: string, on: boolean) => void patch({ allowTools: on ? [...s.allowTools, name] : s.allowTools.filter((x) => x !== name) });

  const remove = async () => {
    if (!window.confirm(t('mcp.remove.confirm', { name: s.label }))) return;
    setBusy(true);
    try {
      await api.mcpDelete(s.id);
      onRemoved(s.id);
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  };

  const st = statusOf(s);
  const oauth = s.authKind === 'oauth';
  const custom = !s.preset;
  if (editing) {
    return (
      <CustomDialog
        server={s}
        onClose={() => setEditing(false)}
        onDone={(next) => {
          setEditing(false);
          apply(next);
        }}
      />
    );
  }

  return (
    <Modal
      title={s.label}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost btn-danger-text" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={14} /> {t('mcp.remove')}
          </button>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="modal-body">
      <div className="mcp-detail-head">
        <Avatar label={s.label} />
        <div>
          <strong className="mono">{mcpHost(s.url)}</strong>
          <StatusChip server={s} />
        </div>
      </div>
      {s.lastError && s.lastError !== AUTH_REQUIRED && <p className="form-error">{s.lastError}</p>}

      <div className="mcp-actions">
        {oauth && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(() => startConnect(s))}>
            <Plug size={14} /> {s.connected ? t('mcp.reconnect') : t('mcp.connect')}
          </button>
        )}
        {oauth && s.connected && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => (await api.mcpDisconnect(s.id)).server)}>
            {t('mcp.disconnect')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => (await api.mcpRefresh(s.id)).server)}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? t('mcp.refreshing') : t('mcp.refresh')}
        </button>
        {custom && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(true)}>
            {t('msg.edit')}
          </button>
        )}
      </div>

      <div className="switch-row">
        <span className="switch-text">
          <strong>{t('mcp.enabled')}</strong>
        </span>
        <button className="switch" role="switch" aria-checked={s.enabled} aria-label={t('mcp.enabled')} disabled={busy} onClick={() => void patch({ enabled: !s.enabled })} />
      </div>
      <div className="switch-row">
        <span className="switch-text">
          <strong>{t('mcp.scope.chat')}</strong>
        </span>
        <button className="switch" role="switch" aria-checked={s.scopes.includes('chat')} aria-label={t('mcp.scope.chat')} disabled={busy} onClick={() => toggleScope('chat')} />
      </div>
      <div className="switch-row">
        <span className="switch-text">
          <strong>{t('mcp.scope.code')}</strong>
        </span>
        <button className="switch" role="switch" aria-checked={s.scopes.includes('code')} aria-label={t('mcp.scope.code')} disabled={busy} onClick={() => toggleScope('code')} />
      </div>
      <div className="switch-row">
        <span className="switch-text">
          <strong>{t('mcp.autoApprove')}</strong>
          <span className="hint">{t('mcp.autoApproveWarn')}</span>
        </span>
        <button className="switch" role="switch" aria-checked={s.autoApprove} aria-label={t('mcp.autoApprove')} disabled={busy} onClick={() => (s.autoApprove ? void patch({ autoApprove: false }) : setWarn(true))} />
      </div>
      {warn && (
        <div className="mcp-warn" role="alert">
          <p>{t('mcp.autoApproveWarn')}</p>
          <div className="mcp-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void patch({ autoApprove: true }).then(() => setWarn(false))}>
              {t('mcp.autoApprove')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setWarn(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <h4 className="mcp-tools-title">
        {t('mcp.tools')} <em>{s.tools.length}</em>
      </h4>
      {st === 'ok' && !s.tools.length && <p className="muted">{t('mcp.noTools')}</p>}
      <ul className="mcp-tools">
        {s.tools.map((tool) => (
          <li key={tool.name}>
            <div className="mcp-tool-main">
              <code>{tool.name}</code>
              <span>{tool.description}</span>
            </div>
            <span className={`mcp-chip ${tool.readOnly ? 'ok' : 'write'}`}>{tool.readOnly ? t('mcp.readOnly') : t('mcp.writes')}</span>
            {!tool.readOnly && (
              <label className="mcp-allow" title={t('mcp.allowAlways')}>
                <button className="switch sm" role="switch" aria-checked={tool.allowed} aria-label={`${t('mcp.allowAlways')}: ${tool.name}`} disabled={busy || s.autoApprove} onClick={() => toggleTool(tool.name, !s.allowTools.includes(tool.name))} />
                <span>{t('mcp.allowAlways')}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
      </div>
    </Modal>
  );
}
