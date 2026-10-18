import { memo, useMemo } from 'react';
import { parseRich } from '@sixfinger/shared';
import { Md as Markdown } from './MarkdownLazy.tsx';
import { ArtifactCard } from './ArtifactCard.tsx';
import { Widget } from './Widget.tsx';

/** Asistan metni: Markdown + (varsa) artifact kartları ve mesaj içi widget'lar. */
export const RichText = memo(function RichText({ text }: { text: string }) {
  const segments = useMemo(() => parseRich(text), [text]);
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'markdown') return <Markdown key={`m${i}`} text={s.text} />;
        if (s.type === 'artifact') return <ArtifactCard key={`a${s.id}${i}`} id={s.id} title={s.title} kind={s.kind} closed={s.closed} size={s.content.length} />;
        return <Widget key={`w${i}`} title={s.title} content={s.content} closed={s.closed} height={s.height} />;
      })}
    </>
  );
});
