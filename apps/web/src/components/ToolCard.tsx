import { useState } from 'react';
import { ChevronRight, CircleAlert, FilePlus, FileText, Globe, Loader, Check, Pencil, Search, Terminal, Wrench } from 'lucide-react';
import { approvalOf, describeTool, type MessagePartDTO } from '@sixfinger/shared';
import { ApprovalCard } from './McpApproval.tsx';
import { useLocale, useT } from '../lib/i18n/index.ts';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

const ICONS = { web_search: Search, web_fetch: Globe, bash: Terminal, read: FileText, write: FilePlus, edit: Pencil } as const;

/** Modelin çağırdığı bir aracın katlanabilir kartı: durum, özet ve (açılınca) girdi/çıktı. */
export function ToolCard({ part, chatId }: { part: ToolPart; chatId?: string }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { label, detail } = describeTool(part, locale);
  const Icon = ICONS[part.name as keyof typeof ICONS] ?? Wrench;
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const canOpen = !running && Boolean(part.output);
  if (chatId && approvalOf(part.meta)) return <ApprovalCard part={part} chatId={chatId} />;

  return (
    <div className={`tool-card${running ? ' running' : ''}${failed ? ' failed' : ''}${open ? ' open' : ''}`}>
      <button className="tool-head" disabled={!canOpen} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tool-icon">
          <Icon size={14} />
        </span>
        <span className="tool-label">{label}</span>
        {detail && <span className="tool-detail">{detail}</span>}
        <span className="tool-state">
          {running ? <Loader size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <Check size={14} />}
          {!running && part.summary && !failed && <span className="tool-summary">{part.summary}</span>}
          {failed && <span className="tool-summary">{t('tool.failed')}</span>}
        </span>
        {canOpen && <ChevronRight size={14} className="tool-chevron" />}
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-section">{t('tool.input')}</div>
          <pre>{JSON.stringify(part.args, null, 2)}</pre>
          <div className="tool-section">{t('tool.output')}</div>
          <pre>{(part.output ?? '').slice(0, 4_000)}</pre>
        </div>
      )}
    </div>
  );
}
