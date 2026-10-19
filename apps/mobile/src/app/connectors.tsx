import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, RefreshControl, ScrollView, Text as RNText, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronRight, Lock, Plus, Search } from 'lucide-react-native';
import { MCP_LIMITS, mcpHost, type McpPresetView, type McpServerDTO, type McpServersResponse } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { haptic } from '../lib/haptics.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { needsOauth, pickLocale, presetAsks, presetRequest, serverStatus, type ConnectInput } from '../lib/mcp.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';
import { Button, Press } from '../components/Ui.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { CodeHeader, SectionLabel } from '../components/code/CodeUi.tsx';
import { ConnectSheet } from '../components/connectors/ConnectSheet.tsx';
import { Avatar, Pill, StatusChip } from '../components/connectors/ConnectorUi.tsx';
import { CustomForm } from '../components/connectors/CustomForm.tsx';
import { ServerSheet } from '../components/connectors/ServerSheet.tsx';

interface Data {
  enabled: boolean;
  servers: McpServerDTO[];
  presets: McpPresetView[];
  limits: McpServersResponse['limits'];
  redirectUrl: string;
}

type Row =
  | { kind: 'label'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'server'; key: string; s: McpServerDTO }
  | { kind: 'preset'; key: string; p: McpPresetView }
  | { kind: 'custom'; key: string }
  | { kind: 'foot'; key: string };

/** Aynı yetkilendirme dönüşü (state) ikinci kez işlenmesin. */
const handledStates = new Set<string>();

/** Bağlayıcılar (MCP): bağlı sunucuların + hazır katalog; özel URL ekleme, ayrıntı ve OAuth dönüşü. */
export default function Connectors() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const guest = useAuth((s) => s.user?.isGuest ?? false);
  const params = useLocalSearchParams<{ mcp_code?: string; mcp_state?: string; mcp?: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [ask, setAsk] = useState<McpPresetView | null>(null);
  const [custom, setCustom] = useState(false);
  /** Bağlanmakta olan kart (katalog kimliği) ya da sunucu (kimlik): düğmede dönen gösterge için. */
  const [busy, setBusy] = useState<string | null>(null);
  const awaiting = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.mcpServers(), api.mcpPresets()]);
      setData({ enabled: s.enabled && p.enabled, servers: s.servers, presets: [...p.presets].sort((a, b) => a.rank - b.rank), limits: s.limits, redirectUrl: s.redirectUrl });
      setFailed(false);
    } catch (err) {
      setFailed(true);
      reportError(err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!guest) void load();
    }, [guest, load]),
  );

  // Tarayıcıdan dönünce (deep link gelmese de) liste tazelenir.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && awaiting.current) {
        awaiting.current = false;
        setBusy(null);
        void load();
      }
    });
    return () => sub.remove();
  }, [load]);

  // OAuth dönüşü: sixfinger://connectors?mcp_code=…&mcp_state=… (başarı) ya da ?mcp=error. Parametreler hemen rotadan silinir.
  useEffect(() => {
    const { mcp_code: code, mcp_state: state, mcp } = params;
    if (!code && !state && !mcp) return;
    router.setParams({ mcp_code: undefined, mcp_state: undefined, mcp: undefined });
    awaiting.current = false;
    setBusy(null);
    if (code && state) {
      if (handledStates.has(state)) return;
      handledStates.add(state);
      api
        .mcpComplete(code, state)
        .then(({ server }) => {
          haptic.success();
          useUi.getState().toast({ kind: 'success', text: t('mcp.connected.toast', { name: server.label }) });
        })
        .catch(() => useUi.getState().toast({ kind: 'error', text: t('mcp.connectFailed') }))
        .finally(() => void load());
    } else if (mcp === 'error') {
      useUi.getState().toast({ kind: 'error', text: t('mcp.connectFailed') });
    }
  }, [params.mcp_code, params.mcp_state, params.mcp]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchServer = useCallback((s: McpServerDTO) => setData((d) => (d ? { ...d, servers: d.servers.some((x) => x.id === s.id) ? d.servers.map((x) => (x.id === s.id ? s : x)) : [...d.servers, s] } : d)), []);

  /** OAuth yetkilendirme sayfasını açar; dönüş derin bağlantıyla (`sixfinger://connectors?…`) gelir. */
  const startOauth = useCallback(
    async (server: McpServerDTO) => {
      try {
        const r = await api.mcpConnect(server.id, 'app');
        patchServer(r.server);
        if (r.authorizeUrl) {
          awaiting.current = true;
          useUi.getState().toast({ kind: 'info', text: t('mcp.connecting') });
          await Linking.openURL(r.authorizeUrl);
        } else {
          void load();
        }
      } catch (err) {
        awaiting.current = false;
        reportError(err);
      }
    },
    [load, patchServer, t],
  );

  /** Eklemeden sonra: OAuth gerekiyorsa hemen yetkilendirmeye geç, değilse sonucu bildir. */
  const afterCreate = useCallback(
    async (server: McpServerDTO) => {
      patchServer(server);
      if (needsOauth(server)) {
        await startOauth(server);
      } else if (server.lastError) {
        useUi.getState().toast({ kind: 'error', text: t('mcp.connectFailed') });
        setDetailId(server.id);
      } else {
        haptic.success();
        useUi.getState().toast({ kind: 'success', text: t('mcp.connected.toast', { name: server.label }) });
      }
      void load();
    },
    [load, patchServer, startOauth, t],
  );

  const full = (data?.servers.length ?? 0) >= (data?.limits.servers ?? MCP_LIMITS.servers);

  const connectPreset = useCallback(
    async (p: McpPresetView, input?: ConnectInput) => {
      if (!data) return;
      if (full) {
        useUi.getState().toast({ kind: 'info', text: t('mcp.limit', { n: data.limits.servers }) });
        return;
      }
      if (!input && presetAsks(p)) {
        setAsk(p);
        return;
      }
      const body = presetRequest(p, input);
      if (!body) return;
      setAsk(null);
      setBusy(p.id);
      try {
        await afterCreate((await api.mcpCreate(body)).server);
      } catch (err) {
        reportError(err);
      } finally {
        if (!awaiting.current) setBusy(null);
      }
    },
    [afterCreate, data, full, t],
  );

  const connectExisting = useCallback(
    async (s: McpServerDTO) => {
      setBusy(s.id);
      try {
        await startOauth(s);
      } finally {
        if (!awaiting.current) setBusy(null);
      }
    },
    [startOauth],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const k = q.trim().toLowerCase();
    const servers = data.servers.filter((s) => !k || `${s.label} ${mcpHost(s.url)}`.toLowerCase().includes(k));
    const presets = data.presets.filter((p) => !k || `${p.label} ${pickLocale(p.description, locale)}`.toLowerCase().includes(k));
    return [
      { kind: 'label', key: 'l-yours', text: t('mcp.yours') },
      ...(servers.length ? servers.map((s) => ({ kind: 'server' as const, key: `s-${s.id}`, s })) : [{ kind: 'text' as const, key: 'empty', text: data.servers.length ? t('sidebar.noResults') : t('mcp.empty') }]),
      { kind: 'label', key: 'l-browse', text: t('mcp.browse') },
      ...(full ? [{ kind: 'text' as const, key: 'limit', text: t('mcp.limit', { n: data.limits.servers }) }] : []),
      ...presets.map((p) => ({ kind: 'preset' as const, key: `p-${p.id}`, p })),
      { kind: 'custom', key: 'custom' },
      ...(data.presets.some((p) => p.reason === 'admin') && data.redirectUrl ? [{ kind: 'foot' as const, key: 'foot' }] : []),
    ];
  }, [data, q, locale, full, t]);

  const detail = data?.servers.find((s) => s.id === detailId) ?? null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  let body;
  if (guest) {
    body = <Gate text={t('mcp.guest')} action={{ label: t('limits.upgrade'), run: () => router.push({ pathname: '/auth', params: { mode: 'register' } }) }} />;
  } else if (!data) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {failed ? <Button label={t('common.retry')} variant="secondary" onPress={() => void load()} /> : <ActivityIndicator color={c.text3} />}
      </View>
    );
  } else if (!data.enabled) {
    body = <Gate text={t('mcp.disabled')} />;
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.text3} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, gap: 12, paddingTop: 4 }}>
            <RNText style={[type.small, { color: c.text3 }]}>{t('mcp.subtitle')}</RNText>
            <View style={{ height: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
              <Search size={16} color={c.text3} />
              <TextInput value={q} onChangeText={setQ} placeholder={t('mcp.search')} placeholderTextColor={c.text3} cursorColor={c.accent} autoCorrect={false} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 15, color: c.text, padding: 0 }} />
            </View>
          </View>
        }
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'label':
              return <SectionLabel>{item.text}</SectionLabel>;
            case 'text':
              return <RNText style={[type.small, { color: c.text3, paddingHorizontal: 20, paddingBottom: 6 }]}>{item.text}</RNText>;
            case 'server':
              return <ServerRow s={item.s} busy={busy === item.s.id} onOpen={() => setDetailId(item.s.id)} onConnect={() => void connectExisting(item.s)} />;
            case 'preset': {
              const added = data.servers.find((s) => s.preset === item.p.id);
              return (
                <PresetRow
                  p={item.p}
                  added={added}
                  busy={busy === item.p.id}
                  disabled={full && !added}
                  onPress={() => (added ? (needsOauth(added) ? void connectExisting(added) : setDetailId(added.id)) : void connectPreset(item.p))}
                />
              );
            }
            case 'custom':
              return (
                <Press haptics="tap" scale={0.985} onPress={() => (full ? useUi.getState().toast({ kind: 'info', text: t('mcp.limit', { n: data.limits.servers }) }) : setCustom(true))} style={{ marginHorizontal: 16, marginTop: 2, height: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: c.lineStrong }}>
                  <Plus size={18} color={c.text2} />
                  <RNText style={{ flex: 1, fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>{t('mcp.custom')}</RNText>
                  <ChevronRight size={16} color={c.text3} />
                </Press>
              );
            case 'foot':
              return (
                <RNText selectable style={[type.small, { color: c.text3, paddingHorizontal: 20, paddingTop: 14 }]}>
                  {t('mcp.redirectHint', { url: data.redirectUrl })}
                </RNText>
              );
          }
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('mcp.title')} onBack={back} />
      {body}
      <ServerSheet server={detail} onClose={() => setDetailId(null)} onChanged={patchServer} onRemoved={(id) => setData((d) => (d ? { ...d, servers: d.servers.filter((s) => s.id !== id) } : d))} onConnect={startOauth} />
      <ConnectSheet preset={ask} onClose={() => setAsk(null)} onSubmit={(p, input) => void connectPreset(p, input)} />
      <Sheet visible={custom} onClose={() => setCustom(false)}>
        <ScrollView style={{ maxHeight: height * 0.74 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <CustomForm
            onCreated={(server) => {
              setCustom(false);
              void afterCreate(server);
            }}
          />
        </ScrollView>
      </Sheet>
    </View>
  );
}

function Gate({ text, action }: { text: string; action?: { label: string; run: () => void } }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16, paddingBottom: 60 }}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Lock size={24} color={c.text2} />
      </View>
      <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{text}</RNText>
      {action && <Button label={action.label} onPress={action.run} style={{ alignSelf: 'stretch' }} />}
    </View>
  );
}

const cardBase = { marginHorizontal: 16, marginBottom: 8, padding: 12, flexDirection: 'row', gap: 12, borderRadius: radius.md, borderWidth: 1 } as const;

/** Eklenmiş sunucunun satırı: ad, ana makine, durum; yetki bekliyorsa doğrudan "Bağlan". */
function ServerRow({ s, busy, onOpen, onConnect }: { s: McpServerDTO; busy: boolean; onOpen: () => void; onConnect: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const status = serverStatus(s);
  return (
    <Press scale={0.985} haptics="select" onPress={onOpen} style={[cardBase, { alignItems: 'center', borderColor: c.line, backgroundColor: c.surface }]}>
      <Avatar label={s.label} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>
          {s.label}
        </RNText>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
          {mcpHost(s.url)}
        </RNText>
        <StatusChip status={status} />
      </View>
      {status.kind === 'needsAuth' ? <ConnectButton label={t('mcp.connect')} busy={busy} onPress={onConnect} /> : <ChevronRight size={16} color={c.text3} />}
    </Press>
  );
}

function ConnectButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Press haptics="tap" scale={0.94} disabled={busy || disabled} onPress={onPress} style={{ minWidth: 84, height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent, opacity: disabled ? 0.45 : 1 }}>
      {busy ? <ActivityIndicator size="small" color={c.onAccent} /> : <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: c.onAccent }}>{label}</RNText>}
    </Press>
  );
}

/** Katalog kartı (Claude'un "Browse connectors" düzeni): avatar, ad + rozet, popülerlik, açıklama, sağda Bağlan. */
function PresetRow({ p, added, busy, disabled, onPress }: { p: McpPresetView; added: McpServerDTO | undefined; busy: boolean; disabled: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const off = !p.available;
  const linked = Boolean(added?.connected && added && !needsOauth(added));
  return (
    <Press scale={0.985} haptics={off ? false : 'select'} disabled={off} onPress={onPress} style={[cardBase, { alignItems: 'flex-start', borderColor: c.line, backgroundColor: c.surface, opacity: off ? 0.6 : 1 }]}>
      <Avatar label={p.label} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>
            {p.label}
          </RNText>
          {p.interactive && <Pill>{t('mcp.interactive')}</Pill>}
        </View>
        <RNText style={[type.small, { color: c.text3, fontSize: 12 }]}>{t('mcp.popular', { n: p.rank })}</RNText>
        <RNText numberOfLines={3} style={[type.small, { color: c.text2, fontSize: 13.5, lineHeight: 19 }]}>
          {pickLocale(p.description, locale)}
        </RNText>
        {p.reason === 'admin' && <RNText style={[type.small, { color: c.text3, fontSize: 12 }]}>{t('mcp.adminHint')}</RNText>}
        {!!p.note && !off && <RNText style={[type.small, { color: c.text3, fontSize: 12 }]}>{pickLocale(p.note, locale)}</RNText>}
        {p.status === 'verify' && !off && <RNText style={[type.small, { color: c.text3, fontSize: 12 }]}>{t('mcp.unverified')}</RNText>}
      </View>
      {off ? (
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 12.5, color: c.text3, maxWidth: 96, textAlign: 'right' }}>{p.reason === 'admin' ? t('mcp.needsAdmin') : t('mcp.soon')}</RNText>
      ) : linked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36 }}>
          <Check size={16} color={c.text2} />
          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: c.text2 }}>{t('mcp.connected')}</RNText>
        </View>
      ) : (
        <ConnectButton label={t('mcp.connect')} busy={busy} disabled={disabled} onPress={onPress} />
      )}
    </Press>
  );
}
