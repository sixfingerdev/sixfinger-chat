import { useState } from 'react';
import { Linking, ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { parseOAuthCallback, type McpServerDTO } from '@sixfinger/shared';
import { api, ApiError } from '../../lib/api.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { Field } from '../Field.tsx';
import { Sheet } from '../Sheet.tsx';
import { Button } from '../Ui.tsx';

export interface PendingManualAuth {
  server: McpServerDTO;
  url: string;
}

/**
 * Masaüstü (kopyala-yapıştır) akışı: yalnızca kendi onayladığı yönlendirme adreslerini kabul eden hizmetler (Canva, Asana, Intercom, Vercel, Indeed) için.
 * Kullanıcı yetkilendirme sayfasını açar; izinden sonra tarayıcı 127.0.0.1'e yönlenir (hata sayfası), adres çubuğundaki adresi kopyalayıp buraya yapıştırır.
 */
export function ManualAuthSheet({ pending, onClose, onDone }: { pending: PendingManualAuth | null; onClose: () => void; onDone: (s: McpServerDTO) => void }) {
  const { height } = useWindowDimensions();
  // Kapanış animasyonu sürerken içerik kaybolmasın diye son istek tutulur.
  const [last, setLast] = useState<PendingManualAuth | null>(null);
  if (pending && pending !== last) setLast(pending);
  const p = pending ?? last;
  return (
    <Sheet visible={Boolean(pending)} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.75 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {p && <Body key={p.url} pending={p} onDone={onDone} />}
      </ScrollView>
    </Sheet>
  );
}

function Body({ pending, onDone }: { pending: PendingManualAuth; onDone: (s: McpServerDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const parsed = parseOAuthCallback(text);
    if (!parsed) return setError(t('mcp.manual.invalid'));
    if ('error' in parsed) return setError(parsed.error);
    setBusy(true);
    setError('');
    try {
      onDone((await api.mcpComplete(parsed.code, parsed.state)).server);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('mcp.connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <RNText style={[type.heading as never, { color: c.text }]}>{t('mcp.manual.title')}</RNText>
      <RNText style={[type.body, { color: c.text }]}>{t('mcp.manual.step1', { name: pending.server.label })}</RNText>
      <Button label={t('mcp.manual.open')} onPress={() => void Linking.openURL(pending.url)} />
      <RNText style={[type.small, { color: c.text2 }]}>{t('mcp.manual.step2')}</RNText>
      <Field
        label={t('mcp.manual.step3')}
        value={text}
        onChangeText={(x) => {
          setText(x);
          setError('');
        }}
        placeholder={t('mcp.manual.placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        error={Boolean(error)}
      />
      {!!error && <RNText style={[type.small, { color: c.danger }]}>{error}</RNText>}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          label={t('mcp.manual.paste')}
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() =>
            void Clipboard.getStringAsync().then((s) => {
              setText(s);
              setError('');
            })
          }
        />
        <Button label={t('mcp.manual.finish')} style={{ flex: 1 }} loading={busy} disabled={!text.trim()} onPress={() => void submit()} />
      </View>
    </View>
  );
}
