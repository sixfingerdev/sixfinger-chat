import { useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { X } from 'lucide-react-native';
import { useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { DEFAULT_API_BASE, getApiBase, setApiBase } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useAuth } from '../store/auth.ts';
import { Field } from '../components/Field.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { Button, Press } from '../components/Ui.tsx';

/** Sunucu adresi ekranı: kendi barındırdığın SixFinger sunucusuna bağlan. */
export default function ConnectScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const clean = url.trim().replace(/\/$/, '');
    if (!/^https:\/\/[^\s/]+/i.test(clean)) {
      haptic.error();
      setError(t('server.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${clean}/api/health`);
      if (!res.ok) throw new Error('bad');
      setApiBase(clean === DEFAULT_API_BASE ? '' : clean);
      haptic.success();
      await useAuth.getState().logout(true); // yeni sunucuda temiz oturum
      router.replace('/');
    } catch {
      haptic.error();
      setError(t('server.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ height: 56, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 8 }}>
        <Press accessibilityLabel={t('common.close')} haptics="tap" scale={0.88} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
          <X size={22} color={c.text2} />
        </Press>
      </View>
      <View style={{ flex: 1, padding: 22, gap: 18, justifyContent: 'center', paddingBottom: insets.bottom + 60 }}>
        <LogoMark size={40} animate={busy} />
        <RNText style={[type.title, { fontSize: 26, lineHeight: 32, color: c.text }]}>{t('server.title')}</RNText>
        <RNText style={[type.body, { color: c.text2 }]}>{t('server.sub')}</RNText>
        <Field label={t('server.url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://chat.ornek.com" error={Boolean(error)} hint={error ?? undefined} />
        <Button label={t('server.connect')} loading={busy} onPress={() => void connect()} style={{ height: 52 }} />
        {url.replace(/\/$/, '') !== DEFAULT_API_BASE && (
          <Button label={DEFAULT_API_BASE.replace('https://', '')} variant="ghost" onPress={() => setUrl(DEFAULT_API_BASE)} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
