import { memo, useRef, useState } from 'react';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { SandboxFrame } from './SandboxFrame.tsx';

/** Mesajın içinde çizilen küçük etkileşimli parça. Etiket kapanana kadar iskelet gösterilir. */
export const Widget = memo(function Widget({ title, content, closed, height }: { title: string; content: string; closed: boolean; height: number | null }) {
  const t = useT();
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(height ?? 160);

  if (!closed) {
    return (
      <div className="widget widget-skeleton" aria-busy="true">
        <span className="waiting-line" />
        <span className="widget-hint">{title || t('widget.preparing')}</span>
      </div>
    );
  }
  return (
    <div className="widget">
      {title && <div className="widget-title">{title}</div>}
      <SandboxFrame
        ref={ref}
        kind="html"
        mode="widget"
        content={content}
        title={title}
        className="widget-frame"
        style={{ height: h }}
        onHeight={(next) => setH(Math.max(60, Math.min(next, 900)))}
        onPrompt={(text) => {
          useUi.getState().setPrefill(text);
          useUi.getState().toast({ kind: 'info', text: t('widget.promptAdded') });
        }}
      />
    </div>
  );
});
