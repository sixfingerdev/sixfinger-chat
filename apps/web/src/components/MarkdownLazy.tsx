import { lazy, Suspense } from 'react';

const Markdown = lazy(() => import('./Markdown.tsx'));

/** Ağır markdown bağımlılıklarını ayrı bir parçaya alır; yüklenirken düz metin gösterir. */
export function Md({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="md" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}>
      <Markdown text={text} />
    </Suspense>
  );
}
