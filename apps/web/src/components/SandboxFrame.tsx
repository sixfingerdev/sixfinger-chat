import { forwardRef, useEffect, useMemo, type CSSProperties, type Ref } from 'react';
import { buildSandboxDoc, parseSandboxMessage, type ArtifactKind } from '@sixfinger/shared';
import { useUi } from '../store/ui.ts';

/** Belge içine enjekte edilen tema değişkenleri (--sf-*): uygulamanın o anki renkleri. */
function themeVars(): { vars: Record<string, string>; dark: boolean } {
  const el = document.documentElement;
  const css = getComputedStyle(el);
  const get = (n: string) => css.getPropertyValue(n).trim();
  return {
    dark: el.dataset.theme !== 'light',
    vars: {
      bg: get('--bg'),
      surface: get('--surface'),
      surface2: get('--surface-2'),
      line: get('--line'),
      text: get('--text'),
      text2: get('--text-2'),
      text3: get('--text-3'),
      accent: get('--accent'),
      font: get('--font-sans'),
      mono: get('--font-mono'),
    },
  };
}

interface Props {
  kind: ArtifactKind;
  content: string;
  mode: 'artifact' | 'widget';
  title?: string;
  className?: string;
  style?: CSSProperties;
  onHeight?: (h: number) => void;
  onPrompt?: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * Model çıktısını izole bir iframe'de çalıştırır: `sandbox="allow-scripts"` (aynı kaynak YOK),
 * katı CSP ve yalnızca postMessage köprüsü. Uygulamanın çerezlerine, depolamasına ya da API'sine erişemez.
 */
export const SandboxFrame = forwardRef<HTMLIFrameElement, Props>(function SandboxFrame(
  { kind, content, mode, title, className, style, onHeight, onPrompt, onError },
  ref: Ref<HTMLIFrameElement>,
) {
  const theme = useUi((s) => s.theme);
  const srcDoc = useMemo(() => {
    const { vars, dark } = themeVars();
    return buildSandboxDoc({ kind, content, mode, vars, dark });
  }, [kind, content, mode, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = (ref as { current: HTMLIFrameElement | null } | null)?.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const m = parseSandboxMessage(e.data);
      if (!m) return;
      if (m.type === 'height') onHeight?.(m.h);
      else if (m.type === 'prompt') onPrompt?.(m.text);
      else onError?.(m.message);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ref, onHeight, onPrompt, onError]);

  return (
    <iframe
      ref={ref}
      className={className}
      style={style}
      title={title ?? 'SixFinger'}
      sandbox="allow-scripts allow-pointer-lock"
      allow="fullscreen; accelerometer; gyroscope"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
});
