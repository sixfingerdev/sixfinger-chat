import { useState } from 'react';
import { ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import type { McpPresetView } from '@sixfinger/shared';
import { useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { presetRequest, pickLocale, type ConnectInput } from '../../lib/mcp.ts';
import { Field } from '../Field.tsx';
import { Sheet } from '../Sheet.tsx';
import { Button } from '../Ui.tsx';
import { Avatar } from './ConnectorUi.tsx';

/**
 * Bağlanmadan önce küçük bir soru gereken katalog kartları için sayfa: adres değişkeni (Shopify mağaza adı) ve/veya
 * OAuth yerine anahtarla bağlanma (Linear, Supabase). `onSubmit` girdilerle çağrılır; `token` boşsa OAuth/değişkenle bağlanır.
 */
export function ConnectSheet({ preset, onClose, onSubmit }: { preset: McpPresetView | null; onClose: () => void; onSubmit: (p: McpPresetView, input: ConnectInput) => void }) {
  const { height } = useWindowDimensions();
  // Kapanış animasyonu sürerken içerik kaybolmasın diye son kart tutulur.
  const [last, setLast] = useState<McpPresetView | null>(null);
  if (preset && preset !== last) setLast(preset);
  const p = preset ?? last;
  return (
    <Sheet visible={Boolean(preset)} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {p && <Body key={p.id} preset={p} onSubmit={onSubmit} />}
      </ScrollView>
    </Sheet>
  );
}

function Body({ preset, onSubmit }: { preset: McpPresetView; onSubmit: (p: McpPresetView, input: ConnectInput) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [values, setValues] = useState<Record<string, string>>({});
  const [token, setToken] = useState('');
  const ready = presetRequest(preset, { values }) !== null;
  const tokenReady = ready && token.trim().length > 0;
  const vars = preset.variables ?? [];

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar label={preset.label} />
        <View style={{ flex: 1, gap: 2 }}>
          <RNText style={[type.heading as never, { color: c.text }]}>{preset.label}</RNText>
          <RNText numberOfLines={2} style={[type.small, { color: c.text3 }]}>
            {pickLocale(preset.description, locale)}
          </RNText>
        </View>
      </View>
      {vars.map((v) => (
        <Field
          key={v.key}
          label={pickLocale(v.label, locale)}
          value={values[v.key] ?? ''}
          onChangeText={(x) => setValues((s) => ({ ...s, [v.key]: x }))}
          placeholder={v.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={61}
        />
      ))}
      {!!preset.note && <RNText style={[type.small, { color: c.text3 }]}>{pickLocale(preset.note, locale)}</RNText>}
      <Button label={preset.token ? t('mcp.useOauth') : t('mcp.connect')} disabled={!ready} onPress={() => onSubmit(preset, { values })} />
      {preset.token && (
        <View style={{ gap: 10, paddingTop: 6 }}>
          <Field
            secure
            label={pickLocale(preset.token.label, locale)}
            hint={preset.token.hint ? pickLocale(preset.token.hint, locale) : undefined}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={2_000}
          />
          <Button variant="secondary" label={t('mcp.useToken')} disabled={!tokenReady} onPress={() => onSubmit(preset, { values, token })} />
        </View>
      )}
    </View>
  );
}
