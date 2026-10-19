import { memo, useState } from 'react';
import {
  Check,
  ArrowUpRight,
  Bot,
  CircleHelp,
  ListChecks,
  Undo2,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CircleDashed,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  Layers,
  Loader,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { describeTool, messageParts, type MessageDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useChats } from '../store/chats.ts';
import { buildAnswerText, type AskQuestion } from '@sixfinger/shared';
import { clsx, compactNumber } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { diffLines, toBlocks, type ToolPart } from '../lib/code-blocks.ts';
import { Delta, Sheet } from './CodeSheets.tsx';
import { PreviewRow, ShareFileRow } from './CodePreview.tsx';
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

function CommitRow({ part, onRewind }: { part: ToolPart; onRewind?: () => void }) {
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
          {onRewind && (
            <>
              <p className="muted">{t('code.rewind.hint')}</p>
              <div className="pr-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    if (!window.confirm(t('code.rewind.confirm'))) return;
                    setOpen(false);
                    onRewind();
                  }}
                >
                  <Undo2 size={15} /> {t('code.rewind.title')}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}

function CompactionRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const before = num(part.meta?.before);
  const after = num(part.meta?.after);
  return (
    <>
      <button className={clsx('code-row quiet', running && 'running', failed && 'failed')} disabled={running || failed} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{running ? <Loader size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <Layers size={14} />}</span>
        <span className="code-row-label">
          {running ? t('code.compact.running') : failed ? t('code.compact.failed') : t('code.compact.done')}
          {!running && !failed && before > 0 && <small> · {t('code.compact.tokens', { before: compactNumber(before), after: compactNumber(after) })}</small>}
        </span>
        {!running && !failed && <ChevronRight size={14} className="code-row-go" />}
      </button>
      {open && (
        <Sheet title={t('code.compact.done')} onClose={() => setOpen(false)}>
          <pre className="step-out">{part.output}</pre>
        </Sheet>
      )}
    </>
  );
}

/** Ajanın tur sonunda açtığı (ya da güncellediği) PR; hata olursa tek dokunuşla yeniden denenir. */
function PullRequestRow({ part, chatId }: { part: ToolPart; chatId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const url = str(part.meta?.url) || (part.output?.startsWith('http') ? part.output : '');
  const number = part.meta?.number;
  const created = part.meta?.created === true;

  const retry = async () => {
    setBusy(true);
    try {
      await api.codeOpenPr(chatId);
      await useChats.getState().openChat(chatId, true);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const label = running ? t('code.pr.opening') : failed ? t('code.pr.failed') : created ? `${t('code.pr.opened')} · #${String(number)}` : t('code.pr.updated');
  const body = (
    <>
      <span className="code-row-icon">{running || busy ? <Loader size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <GitPullRequest size={15} />}</span>
      <span className="code-row-label">
        {label}
        {!running && !failed && created && str(part.meta?.title) && <small> · {str(part.meta?.title)}</small>}
        {failed && part.summary && <small> · {part.summary}</small>}
      </span>
    </>
  );
  if (failed) {
    return (
      <div className="code-row failed">
        {body}
        <button className="link-btn" disabled={busy} onClick={() => void retry()}>
          {t('code.pr.retry')}
        </button>
      </div>
    );
  }
  if (url) {
    return (
      <a className="code-row pr-link" href={url} target="_blank" rel="noreferrer">
        {body}
        <ArrowUpRight size={14} className="code-row-go" />
      </a>
    );
  }
  return <div className="code-row quiet">{body}</div>;
}

/** Ajanın kullanıcıya sorduğu çoktan seçmeli sorular (ask_user). */
function QuestionCard({ part, actions }: { part: ToolPart; actions?: MessageActions }) {
  const t = useT();
  const questions = (Array.isArray(part.meta?.questions) ? part.meta.questions : []) as AskQuestion[];
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map(() => false));
  if (!questions.length) return null;
  const live = Boolean(actions?.answerable);
  const answers = questions.map((q, i) => [...picked[i]!, ...(otherOn[i] && other[i]!.trim() ? [other[i]!.trim()] : [])]);
  const ready = answers.every((a) => a.length > 0);

  const toggle = (qi: number, label: string, multi: boolean) =>
    setPicked((p) => p.map((arr, i) => (i !== qi ? arr : multi ? (arr.includes(label) ? arr.filter((l) => l !== label) : [...arr, label]) : [label])));

  return (
    <div className={clsx('q-card', !live && 'done')}>
      <div className="q-head">
        <CircleHelp size={15} />
        <strong>{t('code.q.title')}</strong>
        {!live && <span className="q-state">{t('code.q.answered')}</span>}
      </div>
      {questions.map((q, qi) => (
        <div key={qi} className="q-block">
          <div className="q-text">
            {q.header && <span className="q-chip">{q.header}</span>} {q.question}
          </div>
          {q.multiSelect && live && <div className="muted">{t('code.q.multi')}</div>}
          <div className="q-options" role={q.multiSelect ? 'group' : 'radiogroup'}>
            {q.options.map((o) => {
              const on = picked[qi]!.includes(o.label);
              return (
                <button
                  key={o.label}
                  className={clsx('q-option', on && 'on')}
                  disabled={!live}
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => {
                    toggle(qi, o.label, Boolean(q.multiSelect));
                    if (!q.multiSelect) setOtherOn((s) => s.map((v, i) => (i === qi ? false : v)));
                  }}
                >
                  <strong>{o.label}</strong>
                  {o.description && <small>{o.description}</small>}
                </button>
              );
            })}
            {live && (
              <button
                className={clsx('q-option', otherOn[qi] && 'on')}
                role="radio"
                aria-checked={otherOn[qi]}
                onClick={() => {
                  setOtherOn((s) => s.map((v, i) => (i === qi ? !v : v)));
                  if (!q.multiSelect) setPicked((p) => p.map((arr, i) => (i === qi ? [] : arr)));
                }}
              >
                <strong>{t('code.q.other')}</strong>
              </button>
            )}
          </div>
          {live && otherOn[qi] && (
            <input className="input q-other" value={other[qi]} placeholder={t('code.q.otherPlaceholder')} maxLength={500} onChange={(e) => setOther((s) => s.map((v, i) => (i === qi ? e.target.value : v)))} />
          )}
        </div>
      ))}
      {live && (
        <div className="pr-actions">
          <button className="btn btn-primary" disabled={!ready} onClick={() => actions!.onAnswer(buildAnswerText(questions, answers))}>
            {t('code.q.send')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Plan modunda ajanın sunduğu plan (exit_plan_mode); onaylanınca ajan uygular. */
function PlanCard({ part, actions }: { part: ToolPart; actions?: MessageActions }) {
  const t = useT();
  const plan = str(part.meta?.plan) || part.output || '';
  const live = Boolean(actions?.answerable);
  return (
    <div className="plan-card">
      <div className="q-head">
        <ListChecks size={15} />
        <strong>{t('code.plan.title')}</strong>
        {!live && <span className="q-state">{t('code.plan.approved')}</span>}
      </div>
      <div className="plan-body">
        <RichText text={plan} />
      </div>
      {live && (
        <div className="pr-actions">
          <button className="btn btn-ghost" onClick={actions!.onRevise}>
            {t('code.plan.revise')}
          </button>
          <button className="btn btn-primary" onClick={actions!.onApprove}>
            {t('code.plan.approve')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Alt ajan (task): satır + (dokununca) görev ve rapor. */
function TaskRow({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const title = str(part.meta?.description) || str(part.args.description) || t('code.task.done');
  return (
    <>
      <button className={clsx('code-row', running && 'running', failed && 'failed')} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{running ? <Loader size={14} className="spin" /> : failed ? <CircleAlert size={14} /> : <Bot size={15} />}</span>
        <span className="code-row-label">
          {running ? `${t('code.task.running')} · ` : `${t('code.task.done')} · `}
          {title}
          {!running && part.summary && !failed && <small> · {part.summary}</small>}
        </span>
        <ChevronRight size={14} className="code-row-go" />
      </button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <div className="usage-row">
            <strong>{t('code.task.prompt')}</strong>
          </div>
          <pre className="step-out">{str(part.args.prompt)}</pre>
          {!running && (
            <>
              <div className="usage-row">
                <strong>{t('code.task.report')}</strong>
              </div>
              <div className="plan-body">
                <RichText text={part.output ?? ''} />
              </div>
            </>
          )}
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

export interface MessageActions {
  /** Bu mesaj son mesaj ve ajan çalışmıyor: soru/plan kartları yanıtlanabilir. */
  answerable: boolean;
  onAnswer: (text: string) => void;
  onApprove: () => void;
  onRevise: () => void;
}

interface Props {
  msg: MessageDTO;
  streaming: boolean;
  actions?: MessageActions;
  /** Bu mesajın sonuna geri sar (ajan çalışmıyorken). */
  onRewind?: (messageId: string) => void;
}

export const CodeMessage = memo(function CodeMessage({ msg, streaming, actions, onRewind }: Props) {
  const t = useT();
  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        {msg.attachments.length > 0 && (
          <div className="msg-attachments">
            {msg.attachments.map((a, i) => (
              <span key={i} className="file-chip" title={a.name}>
                <FileText size={14} />
                <span>{a.name}</span>
              </span>
            ))}
          </div>
        )}
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
              return <CommitRow key={b.part.id} part={b.part} onRewind={onRewind ? () => onRewind(msg.id) : undefined} />;
            case 'compaction':
              return <CompactionRow key={b.part.id} part={b.part} />;
            case 'pull_request':
              return <PullRequestRow key={b.part.id} part={b.part} chatId={msg.chatId} />;
            case 'question':
              return <QuestionCard key={b.part.id} part={b.part} actions={actions} />;
            case 'plan':
              return <PlanCard key={b.part.id} part={b.part} actions={actions} />;
            case 'task':
              return <TaskRow key={b.part.id} part={b.part} />;
            case 'preview':
              return <PreviewRow key={b.part.id} part={b.part} chatId={msg.chatId} />;
            case 'share':
              return <ShareFileRow key={b.part.id} part={b.part} chatId={msg.chatId} />;
            default:
              return <GenericTool key={b.part.id} part={b.part} />;
          }
        })}
        {!streaming && msg.status === 'stopped' && <div className="msg-note">{t('code.session.stopped')}</div>}
        {!streaming && msg.status === 'error' && <div className="msg-note error">{t('code.session.failed')}</div>}
      </div>
    </div>
  );
});
