import { useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text as RNText, View, useWindowDimensions } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { mcpHost, type McpScope, type McpServerDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { ApiError, api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { applyServerPatch, headerPayload, isHttpsUrl, needsOauth, serverStatus, type HeaderRow, type McpPatch } from '../../lib/mcp.ts';
import { useUi } from '../../store/ui.ts';
import { Field } from '../Field.tsx';
import { Sheet } from '../Sheet.tsx';
import { Button, Press } from '../Ui.tsx';
import { Avatar, Divider, Group, Pill, StatusChip, ToggleRow } from './ConnectorUi.tsx';
import { HeaderRows } from './CustomForm.tsx';

interface Props {
  server: McpServerDTO | null;
  onClose: () => void;
  /** Sunucu değişti (iyimser ya da gerçek yanıt): listedeki kayıt yenilenir. */
  onChanged: (s: McpServerDTO) => void;
  /** Kaldırıldı. */
  onRemoved: (id: string) => void;
  /** OAuth yetkilendirmesini (yeniden) başlat. */
  onConnect: (s: McpServerDTO) => Promise<void>;
}

/** Bağlı sunucunun ayrıntıları: açma/kapama, kapsam, onay ayarları, araçlar, bağlantı ve (özel sunucuda) düzenleme. */
export function ServerSheet({ server, onClose, onChanged, onRemoved, onConnect }: Props) {
  const { height } = useWindowDimensions();
  // Kapanış animasyonu sürerken içerik kaybolmasın diye son sunucu tutulur.
  const [last, setLast] = useState<McpServerDTO | null>(null);
  if (server && server !== last) setLast(server);
  const s = server ?? last;
  return (
    <Sheet visible={Boolean(server)} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.74 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {s && <Body key={s.id} s={s} onClose={onClose} onChanged={onChanged} onRemoved={onRemoved} onConnect={onConnect} />}
      </ScrollView>
    </Sheet>
  );
}

function Body({ s, onClose, onChanged, onRemoved, onConnect }: Omit<Props, 'server'> & { s: McpServerDTO }) {
  const { c } = useTheme();
  const t = useT();
  const status = serverStatus(s);
  const custom = s.preset === null;
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState(s.label);
  const [url, setUrl] = useState(s.url);
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [editError, setEditError] = useState('');

  /** Anahtar/ayar değişikliği: önce yerelde uygulanır (anahtar anında döner), sonra sunucuya gider; hata olursa geri alınır. */
  const patch = async (p: McpPatch) => {
    onChanged(applyServerPatch(s, p));
    try {
      onChanged((await api.mcpUpdate(s.id, p)).server);
    } catch (err) {
      onChanged(s);
      reportError(err);
    }
  };

  const toggleScope = (scope: McpScope, on: boolean) => {
    const scopes = on ? [...s.scopes.filter((x) => x !== scope), scope] : s.scopes.filter((x) => x !== scope);
    // En az bir kapsam açık kalmalı.
    if (scopes.length) void patch({ scopes });
  };

  const toggleAuto = (on: boolean) => {
    if (!on) {
      void patch({ autoApprove: false });
      return;
    }
    useUi.getState().askConfirm({
      title: t('mcp.autoApprove'),
      message: t('mcp.autoApproveWarn'),
      confirmLabel: t('mcp.autoApprove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => void patch({ autoApprove: true }),
    });
  };

  const toggleTool = (name: string, on: boolean) => void patch({ allowTools: on ? [...s.allowTools.filter((x) => x !== name), name] : s.allowTools.filter((x) => x !== name) });

  const refresh = async () => {
    setRefreshing(true);
    try {
      onChanged((await api.mcpRefresh(s.id)).server);
    } catch (err) {
      reportError(err);
    } finally {
      setRefreshing(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      await onConnect(s);
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      onChanged((await api.mcpDisconnect(s.id)).server);
      useUi.getState().toast({ kind: 'info', text: t('mcp.disconnected.toast') });
    } catch (err) {
      reportError(err);
    }
  };

  const remove = () => {
    onClose();
    useUi.getState().askConfirm({
      title: t('mcp.remove'),
      message: t('mcp.remove.confirm', { name: s.label }),
      confirmLabel: t('mcp.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.mcpDelete(s.id);
          haptic.success();
          onRemoved(s.id);
        } catch (err) {
          reportError(err);
        }
      },
    });
  };

  // Başlıklar: yeni değer girildiyse kayıtlı başlıkların TAMAMI bu satırlarla değişir (değerler sunucudan hiç dönmez).
  const newHeaders = headerPayload(rows);
  const dirty = custom && (label.trim() !== s.label || url.trim() !== s.url || Boolean(newHeaders));
  const save = async () => {
    setSaving(true);
    setEditError('');
    try {
      onChanged((await api.mcpUpdate(s.id, { label: label.trim(), url: url.trim(), ...(newHeaders ? { headers: newHeaders } : {}) })).server);
      setRows([]);
      haptic.success();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setEditError(err.message);
      else reportError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar label={s.label} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <RNText numberOfLines={1} style={[type.heading as never, { color: c.text }]}>
            {s.label}
          </RNText>
          <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
            {mcpHost(s.url)}
          </RNText>
        </View>
        <StatusChip status={status} />
      </View>

      {!!s.lastError && s.lastError !== 'authorization_required' && (
        <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: c.dangerSoft }}>
          <RNText selectable style={[type.small, { color: c.danger }]}>
            {s.lastError}
          </RNText>
        </View>
      )}

      {s.authKind === 'oauth' || needsOauth(s) ? (
        <View style={{ gap: 8 }}>
          <Button label={s.connected && !needsOauth(s) ? t('mcp.reconnect') : t('mcp.connect')} variant={needsOauth(s) ? 'primary' : 'secondary'} loading={connecting} onPress={() => void connect()} />
          {s.connected && <Button variant="ghost" label={t('mcp.disconnect')} onPress={() => void disconnect()} />}
        </View>
      ) : null}

      <Group>
        <ToggleRow label={t('mcp.enabled')} value={s.enabled} onChange={(v) => void patch({ enabled: v })} />
        <Divider />
        <ToggleRow label={t('mcp.scope.chat')} value={s.scopes.includes('chat')} disabled={s.scopes.length === 1 && s.scopes[0] === 'chat'} onChange={(v) => toggleScope('chat', v)} />
        <Divider />
        <ToggleRow label={t('mcp.scope.code')} value={s.scopes.includes('code')} disabled={s.scopes.length === 1 && s.scopes[0] === 'code'} onChange={(v) => toggleScope('code', v)} />
        <Divider />
        <ToggleRow label={t('mcp.autoApprove')} value={s.autoApprove} onChange={toggleAuto} />
      </Group>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <RNText style={[type.label, { color: c.text3 }]}>
            {t('mcp.tools')} · {s.tools.length}
          </RNText>
          <Press haptics="tap" scale={0.95} disabled={refreshing} onPress={() => void refresh()} style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 }}>
            {refreshing ? <ActivityIndicator size="small" color={c.text2} /> : <RefreshCw size={15} color={c.text2} />}
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: c.text2 }}>{refreshing ? t('mcp.refreshing') : t('mcp.refresh')}</RNText>
          </Press>
        </View>
        {s.tools.length === 0 ? (
          <RNText style={[type.small, { color: c.text3 }]}>{t('mcp.noTools')}</RNText>
        ) : (
          <Group>
            {s.tools.map((tool, i) => (
              <View key={tool.name}>
                {i > 0 && <Divider />}
                <View style={{ paddingVertical: 10, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.monoMedium, fontSize: 13, color: c.text }}>
                      {tool.name}
                    </RNText>
                    <Pill outline={!tool.readOnly}>{tool.readOnly ? t('mcp.readOnly') : t('mcp.writes')}</Pill>
                  </View>
                  {!!tool.description && (
                    <RNText numberOfLines={2} style={[type.small, { color: c.text3 }]}>
                      {tool.description}
                    </RNText>
                  )}
                  {!tool.readOnly && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: s.autoApprove ? 0.5 : 1 }}>
                      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: c.text2 }}>{t('mcp.allowAlways')}</RNText>
                      <Switch value={tool.allowed} disabled={s.autoApprove} onValueChange={(v) => toggleTool(tool.name, v)} trackColor={{ true: c.accent, false: c.surface3 }} />
                    </View>
                  )}
                </View>
              </View>
            ))}
          </Group>
        )}
      </View>

      {custom && (
        <View style={{ gap: 12 }}>
          <RNText style={[type.label, { color: c.text3 }]}>{t('mcp.custom.title')}</RNText>
          <Field label={t('mcp.field.label')} value={label} onChangeText={setLabel} maxLength={60} autoCorrect={false} />
          <Field label={t('mcp.field.url')} value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none" autoCorrect={false} error={Boolean(editError)} />
          <View style={{ gap: 8 }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('mcp.field.headers')}</RNText>
            <HeaderRows rows={rows} onChange={setRows} saved={s.headerNames} />
          </View>
          {!!editError && <RNText style={[type.small, { color: c.danger }]}>{editError}</RNText>}
          <Button label={t('common.save')} loading={saving} disabled={!dirty || !label.trim() || !isHttpsUrl(url)} onPress={() => void save()} />
        </View>
      )}

      <Button variant="danger" label={t('mcp.remove')} onPress={remove} />
    </>
  );
}
