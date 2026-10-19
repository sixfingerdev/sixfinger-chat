import { useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { MCP_LIMITS, type McpServerDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { ApiError, api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { useT } from '../../lib/i18n/index.ts';
import { headerPayload, isHttpsUrl, type HeaderRow } from '../../lib/mcp.ts';
import { Field } from '../Field.tsx';
import { Button, Press } from '../Ui.tsx';

/** Başlık satırları (ad + gizli değer). Değerler asla geri gösterilmez; kayıtlı başlıkların yalnızca adları `saved` ile verilir. */
export function HeaderRows({ rows, onChange, saved }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; saved?: string[] }) {
  const { c } = useTheme();
  const t = useT();
  const set = (i: number, patch: Partial<HeaderRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <View style={{ gap: 8 }}>
      {saved?.map((name) => (
        <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.mono, fontSize: 13, color: c.text2 }}>
            {name}
          </RNText>
          <RNText style={[type.small, { color: c.text3 }]}>· {t('mcp.headerSaved')}</RNText>
        </View>
      ))}
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field value={r.name} onChangeText={(v) => set(i, { name: v })} placeholder={t('mcp.field.headerName')} autoCapitalize="none" autoCorrect={false} maxLength={80} />
          </View>
          <View style={{ flex: 1.1 }}>
            <Field secure value={r.value} onChangeText={(v) => set(i, { value: v })} placeholder={t('mcp.field.headerValue')} autoCapitalize="none" autoCorrect={false} maxLength={MCP_LIMITS.headerValue} />
          </View>
          <Press accessibilityLabel={t('mcp.remove')} haptics="tap" scale={0.88} hitSlop={6} onPress={() => onChange(rows.filter((_, j) => j !== i))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
            <X size={17} color={c.text3} />
          </Press>
        </View>
      ))}
      {rows.length < MCP_LIMITS.headers && (
        <Press haptics="tap" scale={0.97} onPress={() => onChange([...rows, { name: '', value: '' }])} style={{ alignSelf: 'flex-start', height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
          <Plus size={16} color={c.text2} />
          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text2 }}>{t('mcp.addHeader')}</RNText>
        </Press>
      )}
    </View>
  );
}

/** "Özel URL ekle": ad, https adres ve isteğe bağlı başlıklar. Sunucu 400 verirse mesaj formun altında görünür. */
export function CustomForm({ onCreated }: { onCreated: (server: McpServerDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = label.trim().length > 0 && isHttpsUrl(url);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { server } = await api.mcpCreate({ label: label.trim(), url: url.trim(), headers: headerPayload(rows) });
      onCreated(server);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError(err.message);
      else reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <RNText style={[type.heading as never, { color: c.text }]}>{t('mcp.custom.title')}</RNText>
        <RNText style={[type.small, { color: c.text3 }]}>{t('mcp.custom.hint')}</RNText>
      </View>
      <Field label={t('mcp.field.label')} value={label} onChangeText={setLabel} maxLength={60} autoCorrect={false} />
      <Field label={t('mcp.field.url')} value={url} onChangeText={setUrl} placeholder="https://mcp.example.com/mcp" keyboardType="url" autoCapitalize="none" autoCorrect={false} error={Boolean(error)} />
      <View style={{ gap: 8 }}>
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('mcp.field.headers')}</RNText>
        <HeaderRows rows={rows} onChange={setRows} />
      </View>
      {!!error && <RNText style={[type.small, { color: c.danger }]}>{error}</RNText>}
      <Button label={busy ? t('mcp.adding') : t('mcp.add')} disabled={!valid || busy} onPress={() => void submit()} />
    </View>
  );
}
