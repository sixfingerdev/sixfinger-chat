import { createElement } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

/** Yalnızca Expo Web ile geliştirme/görsel doğrulama içindir; Android'de PreviewFrame.tsx (native WebView) kullanılır. */
export function PreviewFrame({ uri, reloadKey, style }: { uri: string; prefix: string; reloadKey: number; style?: StyleProp<ViewStyle> }) {
  return createElement('iframe', {
    key: reloadKey,
    src: uri,
    sandbox: 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock',
    referrerPolicy: 'no-referrer',
    style: { border: 0, width: '100%', height: '100%', background: '#fff', ...(style as object) },
  });
}
