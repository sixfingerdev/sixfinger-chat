import { useState } from 'react';
import { BookOpen, ChevronRight, CircleAlert, Loader } from 'lucide-react';
import type { MessagePartDTO } from '@sixfinger/shared';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { Sheet } from './CodeSheets.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

/** Ajanın yüklediği skill: ad + kaynak; dokununca yüklenen talimat görülür. */
export function SkillRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const name = typeof part.meta?.name === 'string' ? part.meta.name : typeof part.args.name === 'string' ? part.args.name : '';
  const file = typeof part.meta?.file === 'string' ? part.meta.file : '';
  const source = typeof part.meta?.source === 'string' ? part.meta.source : '';
  const failed = part.status === 'error';
  return (
    <>
      <button className={clsx('code-row', failed && 'failed')} disabled={part.status === 'running'} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{part.status === 'running' ? <Loader size={15} className="spin" /> : failed ? <CircleAlert size={15} /> : <BookOpen size={15} />}</span>
        <span className="code-row-label">
          <strong>{t('code.skills.used')}</strong> <code>{name}{file ? `/${file}` : ''}</code>
          {source && <span className="muted"> · {t(`code.skills.source.${source}` as 'code.skills.source.user')}</span>}
        </span>
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={`${t('code.skills.used')}: ${name}`} onClose={() => setOpen(false)}>
          <pre className="step-out">{part.output}</pre>
        </Sheet>
      )}
    </>
  );
}
