import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plug, Plus, Search } from 'lucide-react';
import { MCP_LIMITS, type McpPresetView, type McpServerDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { CustomDialog, PresetCard, PresetDialog, ServerDialog, ServerRow, startConnect } from '../components/Connectors.tsx';

/** Bağlayıcılar (MCP): hazır katalog + özel URL; OAuth ile tek tıkla bağlan, araçları ve onay politikasını yönet. */
export function ConnectorsPage() {
  const t = useT();
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const [params, setParams] = useSearchParams();
  const [servers, setServers] = useState<McpServerDTO[] | null>(null);
  const [presets, setPresets] = useState<McpPresetView[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [picking, setPicking] = useState<McpPresetView | null>(null);
  const [busy, setBusy] = useState(false);
  const guest = Boolean(user?.isGuest);

  const upsert = (s: McpServerDTO) => setServers((cur) => (cur ? (cur.some((x) => x.id === s.id) ? cur.map((x) => (x.id === s.id ? s : x)) : [...cur, s]) : [s]));

  const load = () =>
    Promise.all([api.mcpServers(), api.mcpPresets()])
      .then(([a, b]) => {
        setServers(a.servers);
        setEnabled(a.enabled);
        setRedirectUrl(a.redirectUrl);
        // Kullanılabilir kartlar önce (sıra: popülerlik), yönetici kaydı/yakında olanlar sonda.
        setPresets([...b.presets].sort((x, y) => Number(!x.available) - Number(!y.available) || x.rank - y.rank));
      })
      .catch((err) => {
        setServers([]);
        reportError(err);
      });

  useEffect(() => {
    if (!guest) void load();
    else setServers([]);
  }, [guest]);

  // Yetkilendirme sayfasından dönüş: ?mcp_code&mcp_state (bağlantıyı bu oturumla tamamla) ya da ?mcp=error.
  useEffect(() => {
    const code = params.get('mcp_code');
    const state = params.get('mcp_state');
    const failed = params.get('mcp') === 'error';
    if (!code && !failed) return;
    setParams({}, { replace: true });
    if (failed || !code || !state) {
      useUi.getState().toast({ kind: 'error', text: t('mcp.connectFailed') });
      return;
    }
    api
      .mcpComplete(code, state)
      .then(({ server }) => {
        useUi.getState().toast({ kind: 'success', text: t('mcp.connected.toast', { name: server.label }) });
        upsert(server);
        void load();
      })
      .catch((err) => reportError(err));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const byPreset = useMemo(() => new Map((servers ?? []).filter((s) => s.preset).map((s) => [s.preset!, s])), [servers]);
  const k = q.trim().toLowerCase();
  const shown = presets.filter((p) => !k || `${p.label} ${p.description[locale]}`.toLowerCase().includes(k));
  const mine = (servers ?? []).filter((s) => !k || `${s.label} ${s.url}`.toLowerCase().includes(k));
  const limitReached = (servers?.length ?? 0) >= MCP_LIMITS.servers;
  const openServer = servers?.find((s) => s.id === open) ?? null;

  const connectPreset = async (p: McpPresetView) => {
    const existing = byPreset.get(p.id);
    if (existing) {
      setBusy(true);
      try {
        useUi.getState().toast({ kind: 'info', text: t('mcp.connecting') });
        const next = await startConnect(existing);
        if (next) upsert(next);
      } catch (err) {
        reportError(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (limitReached) {
      useUi.getState().toast({ kind: 'error', text: t('mcp.limit', { n: MCP_LIMITS.servers }) });
      return;
    }
    // Ek bilgi gerekiyorsa (adres değişkeni, anahtar seçeneği) küçük pencere; yoksa tek tıkla bağlan.
    if (p.variables?.length || p.token) {
      setPicking(p);
      return;
    }
    setBusy(true);
    try {
      const { server } = await api.mcpCreate({ label: p.label, url: p.url, preset: p.id });
      upsert(server);
      if (server.authKind === 'oauth') {
        useUi.getState().toast({ kind: 'info', text: t('mcp.connecting') });
        const next = await startConnect(server);
        if (next) upsert(next);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (guest) body = <p className="muted">{t('mcp.guest')}</p>;
  else if (!enabled) body = <p className="muted">{t('mcp.disabled')}</p>;
  else
    body = (
      <>
        <section className="code-section">
          <h3>{t('mcp.yours')}</h3>
          {servers === null ? (
            <div className="skeleton" style={{ height: 72, borderRadius: 16 }} />
          ) : mine.length ? (
            <ul className="skill-list">{mine.map((s) => <ServerRow key={s.id} server={s} onOpen={(x) => setOpen(x.id)} />)}</ul>
          ) : (
            <p className="muted">{t('mcp.empty')}</p>
          )}
          <div>
            <button className="btn btn-ghost btn-sm" disabled={limitReached} onClick={() => setCustom(true)}>
              <Plus size={14} /> {t('mcp.custom')}
            </button>
            {limitReached && <span className="hint"> {t('mcp.limit', { n: MCP_LIMITS.servers })}</span>}
          </div>
        </section>
        <section className="code-section">
          <h3>{t('mcp.browse')}</h3>
          <ul className="mcp-grid">
            {shown.map((p) => (
              <PresetCard key={p.id} preset={p} server={byPreset.get(p.id)} busy={busy} onConnect={(x) => void connectPreset(x)} onOpen={(s) => setOpen(s.id)} />
            ))}
          </ul>
          {presets.some((p) => p.reason === 'admin') && <p className="hint">{t('mcp.adminHint')}</p>}
          {redirectUrl && <p className="hint mono">{t('mcp.redirectHint', { url: redirectUrl })}</p>}
        </section>
      </>
    );

  return (
    <div className="code-page">
      <CodeTopBar title={<><Plug size={15} /> {t('mcp.title')}</>} />
      <div className="code-scroll">
        <div className="code-inner">
          <p className="muted">{t('mcp.subtitle')}</p>
          {enabled && !guest && (
            <label className="code-search">
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mcp.search')} aria-label={t('mcp.search')} />
            </label>
          )}
          {body}
        </div>
      </div>
      {picking && (
        <PresetDialog
          preset={picking}
          onClose={() => setPicking(null)}
          onDone={(s) => {
            setPicking(null);
            if (s) upsert(s);
            void load();
          }}
        />
      )}
      {custom && (
        <CustomDialog
          onClose={() => setCustom(false)}
          onDone={(s) => {
            setCustom(false);
            upsert(s);
            setOpen(s.id);
          }}
        />
      )}
      {openServer && (
        <ServerDialog
          server={openServer}
          onClose={() => setOpen(null)}
          onChanged={upsert}
          onRemoved={(id) => {
            setServers((cur) => (cur ?? []).filter((x) => x.id !== id));
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
