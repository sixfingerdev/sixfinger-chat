import { memo, useState } from 'react';
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CircleDashed,
  FileText,
  GitCommitHorizontal,
  Globe,
  Loader,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { describeTool, messageParts, type MessageDTO } from '@sixfinger/shared';
import { clsx } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { diffLines, toBlocks, type ToolPart } from '../lib/code-blocks.ts';
import type { CodeLive } from '../store/chats.ts';
import { Delta, Sheet } from './CodeSheets.tsx';
import { LogoMark } from './Logo.tsx';
import { ReasoningBlock } from './ReasoningBlock.tsx';
import { RichText } from './RichText.tsx';

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

interface FileMeta {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}
function fileMeta(part: ToolPart): FileMeta {
  const f = (part.meta?.files as Array<Record<string, unknown>> | undefined)?.[0];
  return {
    path: str(f?.path) || str(part.args.path),
    additions: num(f?.additions),
    deletions: num(f?.deletions),
    status: (f?.status as FileMeta['status']) ?? 'modified',
  };
}

function StatusIcon({ part, size = 14 }: { part: ToolPart; size?: number }) {
  if (part.status === 'running') return <Loader size={size} className="spin" />;
  if (part.status === 'error') return <CircleAlert size={size} />;
  return <Check size={size} />;
}

function groupLabel(parts: ToolPart[], t: ReturnType<typeof useT>): string {
  const count = (names: string[]) => parts.filter((p) => names.includes(p.name)).length;
  const cmds = count(['bash']);
  const reads = count(['read']);
  const searches = count(['glob', 'grep', 'web_search', 'web_fetch']);
  return [
    cmds && t('code.group.cmds', { n: cmds }),
    reads && t('code.group.reads', { n: reads }),
    searches && t('code.group.searches', { n: searches }),
  ]
    .filter(Boolean)
    .join(' · ');
}

const ICON = { bash: Terminal, read: FileText, glob: Search, grep: Search, web_search: Search, web_fetch: Globe } as const;

/** Bir komutun/okumanın ayrıntısı (alt sayfada). */
function StepDetail({ part }: { part: ToolPart }) {
  const t = useT();
  const locale = useLocale();
  const { label, detail } = describeTool(part, locale);
  const Icon = ICON[part.name as keyof typeof ICON] ?? Wrench;
  const isBash = part.name === 'bash';
  const command = str(part.meta?.command) || str(part.args.command);
  const exit = part.meta?.exitCode;
  // Sunucu çıktının başına "$ komut" ve "[exit code …]" satırlarını ekler; ikisi de sayfada ayrıca gösterildiği için burada atılır.
  const out = (part.output ?? '').replace(/^\$ [^\n]*\n/, '').replace(/^\[exit code[^\]]*\]\n?/, '').trim();
  return (
    <div className={clsx('step', part.status === 'error' && 'failed')}>
      <div className="step-head">
        <Icon size={14} />
        <strong>{isBash ? t('code.cmd.command') : label}</strong>
        {!isBash && detail && <span className="step-detail">{detail}</span>}
        <span className="step-flags">
          {typeof exit === 'number' && exit !== 0 && <em>{t('code.cmd.exit', { code: exit })}</em>}
          {part.meta?.timedOut === true && <em>{t('code.cmd.timeout')}</em>}
          {part.meta?.background === true && <em>{t('code.cmd.background')}</em>}
          <StatusIcon part={part} size={13} />
        </span>
      </div>
      {isBash && <pre className="step-cmd">{command}</pre>}
      {part.status !== 'running' && <pre className="step-out">{out ? out.slice(0, 6_000) : t('code.cmd.noOutput')}</pre>}
    </div>
  );
}

function GroupRow({ parts }: { parts: ToolPart[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const running = parts.find((p) => p.status === 'running');
  const failed = parts.some((p) => p.status === 'error');
  const Icon = ICON[(running ?? parts[parts.length - 1]!).name as keyof typeof ICON] ?? Terminal;
  return (
    <>
      <button className={clsx('code-row', running && 'running', failed && !running && 'failed')} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{running ? <Loader size={14} className="spin" /> : <Icon size={14} />}</span>
        <span className="code-row-label">{running ? describeTool(running, locale).detail || t('code.group.running') : groupLabel(parts, t)}</span>
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={groupLabel(parts, t)} onClose={() => setOpen(false)}>
          {parts.map((p) => (
            <StepDetail key={p.id} part={p} />
          ))}
        </Sheet>
      )}
    </>
  );
}

/** edit/write çıktısı. */
function EditView({ part }: { part: ToolPart }) {
  const old = part.name === 'edit' ? str(part.args.old_string) : '';
  const next = part.name === 'edit' ? str(part.args.new_string) : str(part.args.content);
  const rows = diffLines(old, next).slice(0, 400);
  return (
    <pre className="diff">
      {rows.map((r, i) => (
        <span key={i} className={`diff-line ${r.kind}`}>
          {(r.kind === 'del' ? '- ' : r.kind === 'add' ? '+ ' : '  ') + r.text}
        </span>
      ))}
    </pre>
  );
}

function FileRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const f = fileMeta(part);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  return (
    <>
      <button className={clsx('code-row file', running && 'running', failed && 'failed')} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{running ? <Loader size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <FileText size={14} />}</span>
        <span className="code-row-path" title={f.path}>
          <bdi>{f.path}</bdi>
        </span>
        {!running && !failed && <Delta add={f.additions} del={f.deletions} />}
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={f.path} onClose={() => setOpen(false)}>
          <div className="usage-row">
            <strong>{failed ? t('tool.failed') : t(`code.file.${f.status}`)}</strong>
            {!failed && <Delta add={f.additions} del={f.deletions} />}
          </div>
          {failed ? <pre className="step-out">{(part.output ?? '').slice(0, 4_000)}</pre> : <EditView part={part} />}
        </Sheet>
      )}
    </>
  );
}

function TodoCard({ part }: { part: ToolPart }) {
  const t = useT();
  const todos = (part.meta?.todos as Array<{ content: string; status: string }> | undefined) ?? [];
  if (!todos.length) return null;
  const done = todos.filter((x) => x.status === 'completed').length;
  return (
    <div className="todo-card">
      <div className="todo-head">
        <strong>{t('code.todo.title')}</strong>
        <span>{t('code.todo.progress', { done, total: todos.length })}</span>
      </div>
      <ul>
        {todos.map((x, i) => (
          <li key={i} className={x.status}>
            {x.status === 'completed' ? <Check size={14} /> : x.status === 'in_progress' ? <CircleDot size={14} /> : <CircleDashed size={14} />}
            <span>{x.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkspaceRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  return (
    <>
      <button className={clsx('code-row quiet', running && 'running', failed && 'failed')} disabled={running || !part.output} onClick={() => setOpen(true)}>
        <span className="code-row-icon">
          <StatusIcon part={part} />
        </span>
        <span className="code-row-label">
          {running ? t('code.ws.running') : t('code.ws.done')}
          {part.summary && !running && <small> · {part.summary}</small>}
        </span>
        {!running && part.output && <ChevronRight size={14} className="code-row-go" />}
      </button>
      {open && (
        <Sheet title={t('code.ws.done')} onClose={() => setOpen(false)}>
          <pre className="step-out">{part.output}</pre>
        </Sheet>
      )}
    </>
  );
}

function CommitRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const subject = str(part.meta?.subject) || str(part.args.message);
  return (
    <>
      <button className="code-row commit" onClick={() => setOpen(true)}>
        <span className="code-row-icon">
          <GitCommitHorizontal size={15} />
        </span>
        <span className="code-row-label">
          <code>{part.summary}</code> {subject}
        </span>
        <Delta add={num(part.meta?.additions)} del={num(part.meta?.deletions)} />
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={t('code.commit.title')} onClose={() => setOpen(false)}>
          <pre className="step-out">{part.output}</pre>
        </Sheet>
      )}
    </>
  );
}

function GenericTool({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="code-row" onClick={() => setOpen(true)}>
        <span className="code-row-icon">
          <Wrench size={14} />
        </span>
        <span className="code-row-label">{part.name}</span>
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={part.name} onClose={() => setOpen(false)}>
          <StepDetail part={part} />
        </Sheet>
      )}
    </>
  );
}

function PhaseLine({ live }: { live: CodeLive | undefined }) {
  const t = useT();
  const phase = live?.phase ?? 'working';
  const text = phase === 'queued' && live?.position ? t('code.phase.queuedPos', { n: live.position }) : t(`code.phase.${phase}`);
  return (
    <div className="phase-line" role="status">
      <span className="phase-dot" aria-hidden />
      {text}
    </div>
  );
}

interface Props {
  msg: MessageDTO;
  streaming: boolean;
  live: CodeLive | undefined;
}

export const CodeMessage = memo(function CodeMessage({ msg, streaming, live }: Props) {
  const t = useT();
  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble">{msg.content}</div>
      </div>
    );
  }
  const blocks = toBlocks(messageParts(msg));
  const lastIdx = blocks.length - 1;
  return (
    <div className={clsx('msg msg-assistant code-msg', streaming && 'is-streaming')}>
      <div className="msg-avatar" aria-hidden>
        <LogoMark size={14} animate={streaming} />
      </div>
      <div className="msg-main">
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'reasoning':
              return <ReasoningBlock key={`r${i}`} text={b.text} thinking={streaming && i === lastIdx} ms={b.ms} />;
            case 'text':
              return <RichText key={`t${i}`} text={b.text} />;
            case 'group':
              return <GroupRow key={b.parts[0]!.id} parts={b.parts} />;
            case 'file':
              return <FileRow key={b.part.id} part={b.part} />;
            case 'todo':
              return <TodoCard key={b.part.id} part={b.part} />;
            case 'workspace':
              return <WorkspaceRow key={b.part.id} part={b.part} />;
            case 'commit':
              return <CommitRow key={b.part.id} part={b.part} />;
            default:
              return <GenericTool key={b.part.id} part={b.part} />;
          }
        })}
        {streaming && <PhaseLine live={live} />}
        {!streaming && msg.status === 'stopped' && <div className="msg-note">{t('code.session.stopped')}</div>}
        {!streaming && msg.status === 'error' && <div className="msg-note error">{t('code.session.failed')}</div>}
      </div>
    </div>
  );
});
