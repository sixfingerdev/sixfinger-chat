import { memo } from 'react';
import { ChevronRight, FileCode2, GitBranch, Image, FileText } from 'lucide-react';
import type { ArtifactKind } from '@sixfinger/shared';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';

const ICONS = { html: FileCode2, svg: Image, mermaid: GitBranch, markdown: FileText } as const;

/** Mesaj içinde artifact'ı temsil eden kart; tıklayınca yan panelde açılır. */
export const ArtifactCard = memo(function ArtifactCard({ id, title, kind, closed, size }: { id: string; title: string; kind: ArtifactKind; closed: boolean; size: number }) {
  const t = useT();
  const open = useUi((s) => s.artifactId === id);
  const Icon = ICONS[kind];
  return (
    <button className={`artifact-card${open ? ' is-open' : ''}${closed ? '' : ' is-writing'}`} onClick={() => useUi.getState().openArtifact(id)}>
      <span className="artifact-card-icon">
        <Icon size={18} />
      </span>
      <span className="artifact-card-text">
        <span className="artifact-card-title">{title}</span>
        <span className="artifact-card-sub">
          {t(`artifact.kind.${kind}` as 'artifact.kind.html')} · {closed ? t('artifact.ready') : `${t('artifact.writing')} ${Math.round(size / 100) / 10}k`}
        </span>
      </span>
      <ChevronRight size={16} className="artifact-card-chev" />
      {!closed && <span className="artifact-card-bar" />}
    </button>
  );
});
