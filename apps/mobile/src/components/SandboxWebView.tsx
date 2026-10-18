import { useMemo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildSandboxDoc, parseSandboxMessage, type ArtifactKind } from '@sixfinger/shared';
import { useTheme } from '../theme/index.tsx';

interface Props {
  kind: ArtifactKind;
  content: string;
  mode: 'artifact' | 'widget';
  style?: StyleProp<ViewStyle>;
  onHeight?: (h: number) => void;
  onPrompt?: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * Model çıktısını izole bir WebView'de çalıştırır: köprü yalnızca postMessage, depolama/çerez kalıcı değil
 * (incognito), dosya erişimi kapalı, sayfa dışına gezinme engelli, belge katı bir CSP ile gelir.
 */
export function SandboxWebView({ kind, content, mode, style, onHeight, onPrompt, onError }: Props) {
  const { c, name } = useTheme();
  const html = useMemo(
    () =>
      buildSandboxDoc({
        kind,
        content,
        mode,
        dark: name === 'dark',
        vars: {
          bg: c.bg,
          surface: c.surface,
          surface2: c.surface2,
          line: c.line,
          text: c.text,
          text2: c.text2,
          text3: c.text3,
          accent: c.accent,
          font: 'system-ui, sans-serif',
          mono: 'ui-monospace, Menlo, monospace',
        },
      }),
    [kind, content, mode, name, c],
  );

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parseSandboxMessage(e.nativeEvent.data);
    if (!m) return;
    if (m.type === 'height') onHeight?.(m.h);
    else if (m.type === 'prompt') onPrompt?.(m.text);
    else onError?.(m.message);
  };

  return (
    <WebView
      // Artifact modelin yazdığı gibi (beyaz zeminli normal sayfa), widget mesajla bütünleşik (saydam).
      style={[{ backgroundColor: mode === 'artifact' ? '#ffffff' : 'transparent' }, style]}
      originWhitelist={['*']}
      source={{ html }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled={false}
      incognito
      cacheEnabled={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      allowFileAccess={false}
      allowUniversalAccessFromFileURLs={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      overScrollMode="never"
      bounces={false}
      scrollEnabled={mode === 'artifact'}
      nestedScrollEnabled
      // Sayfa içinden internete (http/https) gezinmek engellenir; yalnızca verilen belge çalışır.
      onShouldStartLoadWithRequest={(req) => !/^https?:/i.test(req.url)}
    />
  );
}
