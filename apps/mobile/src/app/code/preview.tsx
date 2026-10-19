// PreviewFrame içe aktarması bilerek uzantısızdır: Metro .web.tsx / native varyantını platforma göre seçer.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleAlert, ExternalLink, RefreshCw } from 'lucide-react-native';
import type { CodePreviewDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api, getApiBase } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { useT } from '../../lib/i18n/index.ts';
import { Press } from '../../components/Ui.tsx';
import { CodeHeader } from '../../components/code/CodeUi.tsx';
import { PreviewFrame } from '../../components/code/PreviewFrame';

/** Önizleme (tam ekran): çalışma alanındaki bir HTML dosyası (çok dosyalı artifact) ya da sandbox'taki bir dev-server. */
export default function CodePreview() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ id: string; path?: string; port?: string; root?: string; title?: string }>();
  const [link, setLink] = useState<CodePreviewDTO | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const port = p.port ? Number(p.port) : undefined;

  useEffect(() => {
    let off = false;
    setLink(null);
    setError('');
    api
      .codePreview(p.id, { path: p.path || undefined, port, root: p.root === undefined ? undefined : p.root })
      .then((r) => !off && setLink(r))
      .catch((err) => {
        if (off) return;
        setError(err instanceof Error ? err.message : String(err));
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [p.id, p.path, port, p.root]);

  const src = link ? `${getApiBase()}${link.url}` : '';
  const prefix = link ? `${getApiBase()}${link.url.slice(0, link.url.indexOf('/', '/api/code/preview/'.length))}` : '';
  const title = p.title || (port ? t('code.preview.server', { port }) : p.path) || t('code.preview.title');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/code'));
  const iconBtn = { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader
        title={title}
        subtitle={port ? t('code.preview.hintPort') : t('code.preview.hintFile')}
        onBack={back}
        right={
          <>
            <Press accessibilityLabel={t('code.preview.reload')} haptics="tap" scale={0.88} disabled={!link} onPress={() => setNonce((n) => n + 1)} style={iconBtn}>
              <RefreshCw size={19} color={c.text} />
            </Press>
            <Press accessibilityLabel={t('code.preview.external')} haptics="tap" scale={0.88} disabled={!link} onPress={() => void Linking.openURL(src)} style={iconBtn}>
              <ExternalLink size={19} color={c.text} />
            </Press>
          </>
        }
      />
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {!link && !error && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={c.text3} />
            <RNText style={[type.small, { color: c.text3 }]}>{t('code.preview.loading')}</RNText>
          </View>
        )}
        {!!error && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 }}>
            <CircleAlert size={26} color={c.text2} />
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text, textAlign: 'center' }}>{t('code.preview.failed')}</RNText>
            <RNText style={[type.small, { color: c.text3, textAlign: 'center' }]}>{error}</RNText>
          </View>
        )}
        {link && <PreviewFrame uri={src} prefix={prefix} reloadKey={nonce} style={{ flex: 1 }} />}
      </View>
    </View>
  );
}
