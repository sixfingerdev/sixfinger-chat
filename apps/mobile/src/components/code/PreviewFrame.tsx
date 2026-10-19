import { Linking, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Önizleme sayfası: sunucudan gelen belge (kısa ömürlü token'lı adres) yalıtılmış bir WebView'de açılır. Depolama/çerez kalıcı değil
 * (incognito), dosya erişimi kapalı; yalnızca önizleme önekinin altındaki adreslere gezinilir, diğer bağlantılar tarayıcıda açılır.
 * Sunucu ayrıca `Content-Security-Policy: sandbox` ile sayfayı opak kaynaklı çalıştırır.
 */
export function PreviewFrame({ uri, prefix, reloadKey, style }: { uri: string; prefix: string; reloadKey: number; style?: StyleProp<ViewStyle> }) {
  return (
    <WebView
      key={String(reloadKey)}
      style={[{ backgroundColor: '#ffffff' }, style]}
      originWhitelist={['https://*', 'http://*']}
      source={{ uri }}
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
      nestedScrollEnabled
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(prefix) || req.url.startsWith('about:') || req.url.startsWith('data:') || req.url.startsWith('blob:')) return true;
        // Alt kaynaklar (betik, stil, görsel) ayrı istek olarak gelir; ana belge dışına gezinme tarayıcıya gider.
        if (req.isTopFrame === false) return true;
        if (/^https?:/i.test(req.url)) void Linking.openURL(req.url);
        return false;
      }}
    />
  );
}
