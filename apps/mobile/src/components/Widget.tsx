import { memo, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useUi } from '../store/ui.ts';
import { SandboxWebView } from './SandboxWebView';
import { WaitingLine } from './WaitingLine.tsx';

/** Mesajın içinde çizilen küçük etkileşimli parça. Etiket kapanana kadar iskelet gösterilir. */
export const Widget = memo(function Widget({ title, content, closed, height }: { title: string; content: string; closed: boolean; height: number | null }) {
  const { c } = useTheme();
  const t = useT();
  const [h, setH] = useState(height ?? 160);
  const box = { marginVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' as const };

  if (!closed) {
    return (
      <View style={[box, { padding: 16, gap: 10, minHeight: 72 }]}>
        <WaitingLine />
        <RNText style={[type.small, { color: c.text3 }]}>{title || t('widget.preparing')}</RNText>
      </View>
    );
  }
  return (
    <View style={box}>
      {!!title && <RNText style={[type.label, { color: c.text3, paddingHorizontal: 14, paddingTop: 12, fontFamily: fonts.sansSemibold }]}>{title}</RNText>}
      <SandboxWebView
        kind="html"
        mode="widget"
        content={content}
        style={{ height: h, width: '100%' }}
        onHeight={(next) => setH(Math.max(60, Math.min(next, 900)))}
        onPrompt={(text) => {
          haptic.success();
          useUi.getState().setPrefill(text);
          useUi.getState().toast({ kind: 'info', text: t('widget.promptAdded') });
        }}
      />
    </View>
  );
});
