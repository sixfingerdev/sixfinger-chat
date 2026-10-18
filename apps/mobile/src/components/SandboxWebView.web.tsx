import { createElement, useEffect, useMemo, useRef } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
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
 * Yalnızca Expo Web ile geliştirme/görsel doğrulama içindir (react-native-webview web'de çalışmaz).
 * Android uygulamasında SandboxWebView.tsx (native WebView) kullanılır.
 */
export function SandboxWebView({ kind, content, mode, style, onHeight, onPrompt, onError }: Props) {
  const { c, name } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(
    () =>
      buildSandboxDoc({
        kind,
        content,
        mode,
        dark: name === 'dark',
        vars: { bg: c.bg, surface: c.surface, surface2: c.surface2, line: c.line, text: c.text, text2: c.text2, text3: c.text3, accent: c.accent, font: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' },
      }),
    [kind, content, mode, name, c],
  );
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const m = parseSandboxMessage(e.data);
      if (!m) return;
      if (m.type === 'height') onHeight?.(m.h);
      else if (m.type === 'prompt') onPrompt?.(m.text);
      else onError?.(m.message);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onHeight, onPrompt, onError]);
  const flat = (Array.isArray(style) ? Object.assign({}, ...style.flat()) : style) as Record<string, unknown> | undefined;
  return createElement('iframe', {
    ref,
    srcDoc,
    sandbox: 'allow-scripts allow-pointer-lock',
    style: { border: 0, width: '100%', height: '100%', background: mode === 'artifact' ? '#fff' : 'transparent', ...flat },
  });
}
