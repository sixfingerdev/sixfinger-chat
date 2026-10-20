import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient, type CodeScope } from './code-client.ts';
import { imageToolResult, isImagePath, READ_IMAGE_MAX_MB } from './image-file.ts';
import { applyEdit, lineDiffStats } from './edit-match.ts';
import { ToolError } from './errors.ts';
import { createRateLimiter } from './limits.ts';
import type { ToolContext, ToolDef, ToolResult } from './types.ts';

/**
 * SixFinger Code araçları: bash, read, write, edit, glob, grep, todo. Tasarım kuralları docs/code-agent.md'de
 * (opencode ve aider incelemesinden): satır numaralı okuma, 3 kademeli edit eşleştirmesi, sondan kırpılan çıktı, "Did you mean",
 * düzenleme sonrası sözdizimi kontrolü, model hatalarını döngüyü kırmadan açıklayıcı biçimde geri verme.
 */

const MAX_OUT = 16_000;
const READ_MAX_LINES = 2_000;
const READ_MAX_CHARS = 50_000;
const LINE_MAX_CHARS = 2_000;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** Argümanları doğrular; hata modele "Invalid arguments…" biçiminde döner ki hemen düzeltebilsin. */
function parseArgs<T extends z.ZodTypeAny>(tool: string, schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 5).map((i) => `- ${i.path.join('.') || 'arguments'}: ${i.message}`);
  const given = JSON.stringify(raw);
  throw new ToolError(`Invalid arguments for tool "${tool}":\n${issues.join('\n')}\nGiven: ${given.length > 300 ? `${given.slice(0, 300)}…` : given}\nUpdate the arguments and call the tool again.`);
}

/** Son `max` karakteri satır sınırında kesip başa açıklama koyar (hatalar çıktının sonunda olur). */
export function tailTrim(text: string, max: number): { text: string; omittedLines: number } {
  if (text.length <= max) return { text, omittedLines: 0 };
  let cut = text.slice(text.length - max);
  const nl = cut.indexOf('\n');
  if (nl > -1 && nl < cut.length - 1) cut = cut.slice(nl + 1);
  const omitted = text.slice(0, text.length - cut.length).split('\n').length - 1;
  return { text: cut, omittedLines: Math.max(1, omitted) };
}

// `git -C dir commit`, `git -c k=v push` gibi seçenek+değer çiftlerini de atlar.
const GIT_BLOCKED = /(?:^|[;&|\n(`]\s*)git\s+(?:-[^\s]+(?:\s+[^\s-][^\s]*)?\s+)*(push|rebase|merge|switch|branch|remote|config)\b/;

const SYNTAX: Record<string, (p: string) => string> = {
  '.js': (p) => `node --check ${shq(p)}`,
  '.mjs': (p) => `node --check ${shq(p)}`,
  '.cjs': (p) => `node --check ${shq(p)}`,
  '.json': (p) => `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' ${shq(p)}`,
  '.py': (p) => `python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' ${shq(p)}`,
  '.sh': (p) => `bash -n ${shq(p)}`,
};

/** Düzenlenen dosya için ucuz bir sözdizimi kontrolü; hata varsa modele eklenecek not, yoksa boş metin. */
async function syntaxNote(client: CodeSandboxClient, s: CodeScope, path: string, signal: AbortSignal): Promise<string> {
  const ext = /\.[a-z]+$/i.exec(path)?.[0]?.toLowerCase() ?? '';
  const cmd = SYNTAX[ext];
  if (!cmd || path.includes('..')) return '';
  try {
    const r = await client.exec(s, cmd(path), 15, signal);
    if (r.exitCode === 0 || r.exitCode === 127 || r.timedOut || r.exitCode === null) return '';
    const msg = (r.stderr || r.stdout).trim().split('\n').slice(0, 10).join('\n');
    return `\n\n⚠ Syntax check failed (exit ${r.exitCode}):\n${msg}\nFix this before moving on.`;
  } catch (err) {
    if (signal.aborted) throw err;
    return '';
  }
}

const filePath = z.string().trim().min(1, 'path must not be empty').max(400, 'path is too long');

const bashArgs = z.object({
  command: z.string().min(1, 'command must not be empty').max(8_000, 'command is too long (max 8000 characters); write a script file with the write tool instead'),
  timeout_seconds: z.number().int().min(1).max(900).optional(),
  background: z.boolean().optional(),
});
const readArgs = z.object({ path: filePath, offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(READ_MAX_LINES).optional() });
const writeArgs = z.object({ path: filePath, content: z.string().max(2_000_000, 'content is too large (max ~2 MB); split it into several files') });
const editArgs = z.object({ path: filePath, old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() });
const globArgs = z.object({ pattern: z.string().min(1, 'pattern must not be empty').max(300), path: z.string().max(400).optional() });
const grepArgs = z.object({
  pattern: z.string().min(1, 'pattern must not be empty').max(500),
  path: z.string().max(400).optional(),
  include: z.string().max(200).optional(),
  literal: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
});
const todoArgs = z.object({
  todos: z
    .array(z.object({ content: z.string().min(1).max(300), status: z.enum(['pending', 'in_progress', 'completed']), id: z.string().max(40).optional() }))
    .max(40, 'at most 40 todo items'),
});

const FILE_ALIASES = { path: ['file_path', 'filepath', 'filePath', 'filename', 'file'] };

export function createCodeTools(client: CodeSandboxClient): ToolDef[] {
  const limiter = createRateLimiter(240, 60_000);
  const available = () => true;
  const locks = new Map<string, Promise<unknown>>();

  const scope = (ctx: ToolContext): CodeScope => {
    if (!ctx.code) throw new ToolError('This tool only works inside a Code session.');
    return { user: ctx.user.id, session: ctx.code.session };
  };
  const guard = (ctx: ToolContext) => {
    if (!limiter.take(ctx.user.id)) throw new ToolError('Too many tool calls in a short time. Wait a moment and try again.');
  };
  /** sandboxd yeniden başlamışsa çalışma alanını hazırlayıp çağrıyı bir kez daha dener. */
  async function withWorkspace<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NotPreparedError && ctx.code) {
        await ctx.code.prepare();
        return await fn();
      }
      throw err;
    }
  }
  /** Aynı dosyaya aynı anda iki düzenleme yapılmasın. */
  async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    void tail.then(() => locks.get(key) === tail && locks.delete(key));
    return run;
  }

  // ---------------------------------------------------------------------------------------------------------------- bash
  const bash: ToolDef = {
    name: 'bash',
    maxOutputChars: MAX_OUT + 600,
    description:
      'Runs a bash command in the project workspace (/work, the repository root). Use it for installing dependencies, running builds, tests, linters, scripts and read-only git commands (status, diff, log, show). ' +
      'Each call starts a fresh shell: the working directory and environment do NOT persist, so use `cd dir && command` when needed. There is no TTY; never run interactive commands. ' +
      'Prefer the dedicated tools for reading (read), searching (grep, glob) and editing (edit, write) files instead of cat/grep/sed. ' +
      'Default timeout is 120 seconds (max 900). For long-running servers or watchers set background=true: the command keeps running and its log file path is returned; do not poll it in a loop. ' +
      'You may commit your own work with git add <files> + git commit (stage explicit paths, never dependencies, virtualenvs, caches or build output). Do NOT run git push, rebase, merge, switch, branch, remote or config: the platform owns the branch and pushes it. ' +
      'The network is limited by the environment policy; a "blocked by SixFinger network policy" message means that host is not allowed. When output is large only the END is returned; pipe to grep/tail/head to see specific parts.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run.' },
        timeout_seconds: { type: 'integer', description: 'Timeout in seconds (1-900, default 120).' },
        background: { type: 'boolean', description: 'Run detached and return immediately with a log path.' },
      },
      required: ['command'],
    },
    aliases: { command: ['cmd', 'script', 'bash', 'code'], timeout_seconds: ['timeout', 'timeoutSeconds'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('bash', bashArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      if (GIT_BLOCKED.test(a.command)) {
        throw new ToolError('This git command is managed by the platform (it owns the working branch and pushes it). Do not run git push/rebase/merge/switch/branch/remote/config. git status, diff, log, show, add and commit are fine.');
      }
      if (a.background) {
        const id = randomBytes(3).toString('hex');
        const b64 = Buffer.from(a.command).toString('base64');
        const wrapped = `echo ${b64} | base64 -d > /tmp/sf-bg-${id}.sh && (setsid nohup bash /tmp/sf-bg-${id}.sh > /tmp/sf-bg-${id}.log 2>&1 < /dev/null & echo $! > /tmp/sf-bg-${id}.pid); sleep 1.5; tail -n 15 /tmp/sf-bg-${id}.log`;
        const r = await withWorkspace(ctx, () => client.exec(s, wrapped, 30, ctx.signal));
        const head = `Started background job ${id}. Log file: /tmp/sf-bg-${id}.log (or use the job_output tool with id "${id}"; stop it with job_kill). It keeps running while this workspace stays active.`;
        return { output: [head, r.stdout.trim() ? `First log lines:\n${r.stdout.trim()}` : ''].filter(Boolean).join('\n'), summary: `background ${id}`, meta: { command: a.command.slice(0, 200), background: true, jobId: id } };
      }
      const r = await withWorkspace(ctx, () => client.exec(s, a.command, a.timeout_seconds ?? 120, ctx.signal));
      const status = r.timedOut
        ? `[timed out after ${seconds(r.durationMs)}: the command was killed. Retry with a larger timeout_seconds (max 900) or background=true]`
        : `[exit code ${r.exitCode ?? '?'} · ${seconds(r.durationMs)}]`;
      const body = [r.stdout.replace(/\n$/, ''), r.stderr.trim() ? `[stderr]\n${r.stderr.replace(/\n$/, '')}` : ''].filter(Boolean).join('\n');
      const t = tailTrim(body, MAX_OUT);
      const total = body ? body.split('\n').length : 0;
      const parts = [`$ ${a.command.length > 300 ? `${a.command.slice(0, 300)}…` : a.command}`, status];
      if (t.omittedLines) parts.push(`[output truncated: showing the last ${total - t.omittedLines} of ${total} lines. Pipe to grep/tail/head to inspect other parts]`);
      parts.push(t.text || '(no output)');
      if (r.truncated) parts.push('[output hit the capture limit and was cut]');
      const code = ctx.code!;
      if (r.diskUsedMb >= code.diskMb * 0.8) parts.push(`[disk: ${r.diskUsedMb} / ${code.diskMb} MB used. Remove build output, caches or node_modules you no longer need]`);
      return {
        output: parts.join('\n'),
        summary: r.timedOut ? 'timed out' : `exit ${r.exitCode ?? '?'} · ${seconds(r.durationMs)}`,
        meta: { command: a.command.slice(0, 300), exitCode: r.exitCode, durationMs: r.durationMs, timedOut: r.timedOut },
      };
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- job_output / job_kill
  const JOB_ID = /^[a-f0-9]{6}$/;
  const jobOutput: ToolDef = {
    name: 'job_output',
    maxOutputChars: MAX_OUT + 600,
    description: 'Shows the latest output and the state (running or exited) of a background job started with bash background=true. Use it to check a dev server, watcher or long build instead of re-running commands.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The job id returned by bash (6 hex characters).' },
        tail_lines: { type: 'integer', description: 'How many last log lines to show (default 60, max 400).' },
      },
      required: ['id'],
    },
    aliases: { id: ['job', 'job_id', 'jobId'], tail_lines: ['lines', 'tail', 'n'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('job_output', z.object({ id: z.string().regex(JOB_ID, 'must be the 6-character job id'), tail_lines: z.number().int().min(1).max(400).optional() }), raw);
      const s = scope(ctx);
      guard(ctx);
      const n = a.tail_lines ?? 60;
      const r = await withWorkspace(ctx, () => client.exec(s, `if [ ! -f /tmp/sf-bg-${a.id}.log ]; then echo NOJOB; exit 0; fi; tail -n ${n} /tmp/sf-bg-${a.id}.log; echo '---STATE---'; if kill -0 "$(cat /tmp/sf-bg-${a.id}.pid 2>/dev/null)" 2>/dev/null; then echo running; else echo exited; fi`, 20, ctx.signal));
      if (r.stdout.trim() === 'NOJOB') throw new ToolError(`No background job "${a.id}" in this workspace (it may have been lost when the workspace container restarted).`);
      const [log = '', state = ''] = r.stdout.split('---STATE---');
      return { output: `[job ${a.id}: ${state.trim() || 'unknown'}]\n${tailTrim(log.trim(), MAX_OUT).text || '(no output yet)'}`, summary: `${a.id} ${state.trim()}`, meta: { jobId: a.id, state: state.trim() } };
    },
  };
  const jobKill: ToolDef = {
    name: 'job_kill',
    description: 'Stops a background job started with bash background=true.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'The job id returned by bash (6 hex characters).' } }, required: ['id'] },
    aliases: { id: ['job', 'job_id', 'jobId'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('job_kill', z.object({ id: z.string().regex(JOB_ID, 'must be the 6-character job id') }), raw);
      const s = scope(ctx);
      guard(ctx);
      const r = await withWorkspace(ctx, () => client.exec(s, `p="$(cat /tmp/sf-bg-${a.id}.pid 2>/dev/null)"; if [ -z "$p" ]; then echo NOJOB; else kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null; echo stopped; fi`, 20, ctx.signal));
      if (r.stdout.trim() === 'NOJOB') throw new ToolError(`No background job "${a.id}" in this workspace.`);
      return { output: `Stopped job ${a.id}.`, summary: `stopped ${a.id}`, meta: { jobId: a.id } };
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- read
  const read: ToolDef = {
    name: 'read',
    maxOutputChars: READ_MAX_CHARS + 600,
    description:
      'Reads a file (or lists a directory) in the workspace. Image files (.png, .jpg, .jpeg, .webp; e.g. a screenshot the user uploaded to `.sixfinger/uploads/`) are shown to you as an image so you can look at them. Each line is prefixed with its 1-based line number as `<line>: <content>`; do not include that prefix when you later pass text to edit. ' +
      `Returns up to ${READ_MAX_LINES} lines; for longer files continue with offset. Prefer one larger read over many small slices, and use grep to find where to look in big files. Read a file before you edit it.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path, relative to the repository root.' },
        offset: { type: 'integer', description: 'First line to read (1-based, default 1).' },
        limit: { type: 'integer', description: `Number of lines (default and max ${READ_MAX_LINES}).` },
      },
      required: ['path'],
    },
    aliases: { ...FILE_ALIASES, offset: ['start', 'start_line', 'line'], limit: ['lines', 'max_lines'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('read', readArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      if (isImagePath(a.path)) {
        try {
          return imageToolResult(a.path, await withWorkspace(ctx, () => client.raw(s, a.path, READ_IMAGE_MAX_MB, ctx.signal)));
        } catch (err) {
          if (err instanceof FileNotFoundError) throw new ToolError(`File not found: ${a.path}`);
          throw err;
        }
      }
      let f;
      try {
        f = await withWorkspace(ctx, () => client.read(s, a.path, ctx.signal));
      } catch (err) {
        if (err instanceof IsDirectoryError) {
          const ls = await withWorkspace(ctx, () => client.exec(s, `ls -1Ap -- ${shq(a.path)} | head -n 300`, 15, ctx.signal));
          return { output: `Directory: ${a.path}\n${ls.stdout.trim() || '(empty)'}`, summary: 'directory', meta: { directory: a.path } };
        }
        if (err instanceof FileNotFoundError) {
          const base = a.path.split('/').filter(Boolean).pop() ?? a.path;
          const near = await withWorkspace(ctx, () => client.glob(s, { pattern: `**/*${base.replace(/\.[^.]*$/, '')}*`, limit: 5 }, ctx.signal)).catch(() => ({ files: [] as string[] }));
          throw new ToolError(`File not found: ${a.path}${near.files.length ? `\nDid you mean one of these?\n${near.files.join('\n')}` : ''}`);
        }
        throw err;
      }
      const lines = f.content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const start = (a.offset ?? 1) - 1;
      if (start > 0 && start >= lines.length) throw new ToolError(`offset ${a.offset} is past the end of the file (${lines.length} lines).`);
      let chars = 0;
      const shown: string[] = [];
      for (let i = start; i < lines.length && shown.length < (a.limit ?? READ_MAX_LINES); i++) {
        let l = lines[i]!;
        if (l.length > LINE_MAX_CHARS) l = `${l.slice(0, LINE_MAX_CHARS)}... (line truncated to ${LINE_MAX_CHARS} chars)`;
        chars += l.length + 8;
        if (chars > READ_MAX_CHARS && shown.length) break;
        shown.push(`${i + 1}: ${l}`);
      }
      const last = start + shown.length;
      const notes: string[] = [];
      if (last < lines.length) notes.push(`[Output truncated. ${lines.length - last} more lines. Continue reading with offset: ${last + 1}]`);
      if (f.truncated) notes.push('[the file hit the size limit and was cut]');
      return {
        output: [`File: ${a.path} (${lines.length} lines)`, shown.join('\n') || '(empty file)', ...notes].join('\n'),
        summary: `${lines.length} lines`,
        meta: { path: a.path, lines: lines.length },
      };
    },
  };

  // --------------------------------------------------------------------------------------------------------------- write
  const write: ToolDef = {
    name: 'write',
    description:
      'Creates a file or replaces its whole content (parent directories are created automatically). Use it for new files and complete rewrites; for a change to part of an existing file use edit. ' +
      'Never write placeholders such as "... rest of the file": always write the complete content. Code that only appears in your text reply is NOT saved; it must go through this tool.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the repository root.' }, content: { type: 'string', description: 'The complete file content.' } },
      required: ['path', 'content'],
    },
    aliases: { ...FILE_ALIASES, content: ['contents', 'text', 'file_content', 'fileContent', 'data'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('write', writeArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      return withFileLock(`${s.session}:${a.path}`, async () => {
        const before = await withWorkspace(ctx, () => client.read(s, a.path, ctx.signal)).catch((e) => (e instanceof FileNotFoundError ? null : undefined));
        await withWorkspace(ctx, () => client.write(s, a.path, a.content, ctx.signal));
        const stats = before ? lineDiffStats(before.content, a.content) : { additions: a.content === '' ? 0 : a.content.split('\n').length - (a.content.endsWith('\n') ? 1 : 0), deletions: 0 };
        const n = a.content === '' ? 0 : a.content.split('\n').length - (a.content.endsWith('\n') ? 1 : 0);
        const note = await syntaxNote(client, s, a.path, ctx.signal);
        return {
          output: `${before === null ? 'Created' : 'Wrote'} ${a.path} (${n} lines, +${stats.additions} −${stats.deletions})${note}`,
          summary: `+${stats.additions} −${stats.deletions}`,
          meta: { files: [{ path: a.path, additions: stats.additions, deletions: stats.deletions, status: before === null ? 'added' : 'modified' }] },
        };
      });
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- edit
  const edit: ToolDef = {
    name: 'edit',
    description:
      'Replaces text in an existing file. old_string must match the file exactly once (whitespace and indentation included); if it matches several places the edit FAILS unless replace_all is true, so include enough surrounding lines to make it unique. ' +
      'Copy the text from the read output but omit the "<line>: " number prefixes. If there is no exact match the tool retries while ignoring typographic quote/dash/space variants and trailing whitespace on each line; if that also fails it shows the closest text in the file. ' +
      'Read the file first. To create a file or rewrite it completely use write. Make several small edits rather than one huge one.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the repository root.' },
        old_string: { type: 'string', description: 'The exact existing text to replace.' },
        new_string: { type: 'string', description: 'The replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every match (default false).' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    aliases: {
      ...FILE_ALIASES,
      old_string: ['oldString', 'old_str', 'old', 'search', 'find', 'old_text', 'oldText'],
      new_string: ['newString', 'new_str', 'new', 'replace', 'replacement', 'new_text', 'newText'],
      replace_all: ['replaceAll', 'all'],
    },
    available,
    async run(raw, ctx) {
      const a = parseArgs('edit', editArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      return withFileLock(`${s.session}:${a.path}`, async () => {
        let f;
        try {
          f = await withWorkspace(ctx, () => client.read(s, a.path, ctx.signal));
        } catch (err) {
          if (err instanceof FileNotFoundError) throw new ToolError(`File not found: ${a.path}. To create a new file use the write tool.`);
          throw err;
        }
        if (f.truncated) throw new ToolError('This file is too large to edit with this tool. Use bash (sed/python) for a targeted change.');
        const r = applyEdit(f.content, a.old_string, a.new_string, a.replace_all ?? false);
        if (!r.ok) throw new ToolError(r.error);
        await withWorkspace(ctx, () => client.write(s, a.path, r.content, ctx.signal));
        const stats = lineDiffStats(f.content, r.content);
        const out = r.content.split('\n');
        const newLines = a.new_string.split('\n').length;
        const from = Math.max(1, r.line - 3);
        const to = Math.min(out.length, r.line + newLines + 2);
        const snippet = out.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
        const note = await syntaxNote(client, s, a.path, ctx.signal);
        return {
          output: `Edited ${a.path} (${r.replacements} replacement${r.replacements > 1 ? 's' : ''}, +${stats.additions} −${stats.deletions}${r.strategy === 'exact' ? '' : `, matched ignoring ${r.strategy === 'normalized' ? 'typographic characters' : 'trailing whitespace'}`})\n${snippet}${note}`,
          summary: `+${stats.additions} −${stats.deletions}`,
          meta: { files: [{ path: a.path, additions: stats.additions, deletions: stats.deletions, status: 'modified', replacements: r.replacements }] },
        };
      });
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- glob
  const glob: ToolDef = {
    name: 'glob',
    description: 'Finds files by name pattern (for example "**/*.ts", "src/**/test_*.py", "package.json"). Respects .gitignore and skips .git. Returns paths sorted alphabetically (max 100). Use it to explore the project layout.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Glob pattern.' }, path: { type: 'string', description: 'Directory to search in (default: the repository root).' } },
      required: ['pattern'],
    },
    aliases: { pattern: ['glob', 'query', 'name'], path: ['dir', 'directory', 'folder', 'cwd'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('glob', globArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      const r = await withWorkspace(ctx, () => client.glob(s, { pattern: a.pattern, path: a.path, limit: 100 }, ctx.signal));
      const out = r.files.length ? [`${r.files.length}${r.truncated ? '+' : ''} files`, ...r.files, ...(r.truncated ? ['[showing the first 100; narrow the pattern or path]'] : [])] : ['No files matched. Check the pattern, or use a broader one such as "**/*name*".'];
      return { output: out.join('\n'), summary: `${r.files.length}${r.truncated ? '+' : ''} files`, meta: { count: r.files.length } };
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- grep
  const grep: ToolDef = {
    name: 'grep',
    description:
      'Searches file contents with a regular expression (ripgrep syntax; set literal=true for plain text). Respects .gitignore, skips .git, node_modules and similar. Smart-case by default. Returns matches grouped by file with line numbers (max 100). ' +
      'Use include to restrict by file name (for example "*.tsx"). Use it to find definitions and usages before reading or editing.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression (or literal text with literal=true).' },
        path: { type: 'string', description: 'Directory or file to search (default: the repository root).' },
        include: { type: 'string', description: 'File name glob, for example "*.ts".' },
        literal: { type: 'boolean', description: 'Treat pattern as plain text.' },
        case_sensitive: { type: 'boolean', description: 'Force case-sensitive matching (default: smart-case).' },
      },
      required: ['pattern'],
    },
    aliases: { pattern: ['query', 'regex', 'search', 'text'], include: ['glob', 'file_pattern', 'filePattern'], case_sensitive: ['caseSensitive'], path: ['dir', 'directory', 'folder'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('grep', grepArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      const r = await withWorkspace(ctx, () => client.grep(s, { pattern: a.pattern, path: a.path, include: a.include, literal: a.literal, caseSensitive: a.case_sensitive, limit: 100 }, ctx.signal));
      if (!r.lines.length) return { output: 'No matches found.', summary: '0 matches', meta: { count: 0 } };
      const byFile = new Map<string, string[]>();
      for (const l of r.lines) {
        const m = /^(.+?):(\d+):(.*)$/.exec(l);
        if (!m) continue;
        const list = byFile.get(m[1]!) ?? [];
        list.push(`  Line ${m[2]}: ${m[3]!.trimEnd()}`);
        byFile.set(m[1]!, list);
      }
      const out = [`Found ${r.lines.length}${r.truncated ? '+' : ''} matches in ${byFile.size} files`];
      for (const [f, ls] of byFile) out.push(f, ...ls);
      if (r.truncated) out.push('[showing the first 100 matches; narrow the pattern, path or include]');
      return { output: out.join('\n'), summary: `${r.lines.length}${r.truncated ? '+' : ''} matches`, meta: { count: r.lines.length } };
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- todo
  const todo: ToolDef = {
    name: 'todo',
    description:
      'Keeps a visible checklist of the steps of a multi-step task. Send the COMPLETE list every time (it replaces the previous one). Use it for work with 3 or more steps: write the plan first, mark exactly one item in_progress while you work on it, and mark items completed as soon as they are done. Skip it for trivial one-step requests.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full todo list.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'What to do (short, imperative).' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              id: { type: 'string', description: 'Optional stable id.' },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    aliases: { todos: ['items', 'tasks', 'list', 'todo_list', 'todoList'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('todo', todoArgs, raw);
      scope(ctx);
      const n = (st: string) => a.todos.filter((t) => t.status === st).length;
      const todos = a.todos.map((t, i) => ({ id: t.id ?? String(i + 1), content: t.content, status: t.status }));
      return {
        output: `Todo list updated: ${a.todos.length} items (${n('completed')} completed, ${n('in_progress')} in progress, ${n('pending')} pending). Continue with the in-progress item.`,
        summary: `${n('completed')}/${a.todos.length}`,
        meta: { todos },
      } satisfies ToolResult;
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- preview
  const previewArgs = z
    .object({
      path: z.string().trim().min(1).max(400).optional(),
      port: z.number().int().min(1024, 'port must be 1024-65535').max(65535, 'port must be 1024-65535').optional(),
      root: z.string().trim().max(400).optional(),
      title: z.string().trim().max(80).optional(),
    })
    .refine((v) => Boolean(v.path) !== Boolean(v.port), { message: 'give exactly one of path (a file) or port (a running server)' });
  const preview: ToolDef = {
    name: 'preview',
    description:
      'Shows the user a live preview of something you built, right under your message. Two modes (give exactly one): ' +
      '(1) path = an HTML file in the workspace (or a directory containing index.html). It is served statically with every file next to it, so a page with its own .js, .css, images and ES modules works: write index.html + app.js + style.css, then preview index.html. External libraries from CDNs (cdnjs, jsdelivr, unpkg) work. Use relative URLs or root-absolute ones ("/app.js" resolves inside the preview root, which defaults to the HTML file\'s folder; set root to serve from another folder, e.g. "dist"). ' +
      '(2) port = a dev server you started with bash background=true (it may listen on localhost). The page is proxied through the platform under a path prefix, so the app must use relative URLs (for Vite set base: "./"); WebSocket/HMR does not work, the user refreshes to see changes. For frameworks prefer building (npm run build) and previewing the output folder statically. ' +
      'The preview runs isolated: no cookies, localStorage may be unavailable, and fetch("/api/...") to your own server only works through a port preview with relative URLs. Call it once when the thing works; do not call it for non-visual changes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'HTML file (or directory with index.html), relative to the repository root.' },
        port: { type: 'integer', description: 'Port of a server already running in the sandbox (1024-65535).' },
        root: { type: 'string', description: 'Static mode only: folder that "/"-absolute URLs resolve against (default: the HTML file\'s folder).' },
        title: { type: 'string', description: 'Short title shown on the preview card.' },
      },
    },
    aliases: { path: ['file', 'file_path', 'entry', 'html'], port: ['server_port'], title: ['name', 'label'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('preview', previewArgs, raw);
      const s = scope(ctx);
      guard(ctx);
      if (a.port) {
        const ports = await withWorkspace(ctx, () => client.ports(s, ctx.signal));
        if (!ports.includes(a.port)) {
          throw new ToolError(`Nothing is listening on port ${a.port}${ports.length ? ` (listening: ${ports.join(', ')})` : ''}. Start the server with bash background=true, check job_output until it says it is ready, then call preview again.`);
        }
        return { output: `Preview of the server on port ${a.port} is ready; the user can open it from the card under your message. Mention how it can be used and that the user should refresh after changes.`, summary: `port ${a.port}`, meta: { port: a.port, title: a.title ?? `localhost:${a.port}` } };
      }
      let entry = a.path!.replace(/^\/work\//, '').replace(/^\.\//, '');
      let root = a.root?.replace(/^\/work\//, '').replace(/^\.\//, '');
      try {
        await withWorkspace(ctx, () => client.raw(s, entry, 8, ctx.signal));
      } catch (err) {
        if (err instanceof IsDirectoryError) {
          root ??= entry;
          entry = `${entry.replace(/\/$/, '')}/index.html`;
          await withWorkspace(ctx, () => client.raw(s, entry, 8, ctx.signal)).catch((e) => {
            throw e instanceof FileNotFoundError ? new ToolError(`${entry} does not exist. Write an HTML file first.`) : e;
          });
        } else if (err instanceof FileNotFoundError) throw new ToolError(`File not found: ${entry}. Write it first, then call preview.`);
        else throw err;
      }
      return { output: `Preview of ${entry} is ready; the user can open it from the card under your message. In your reply say what it shows and how to use it (controls, keys).`, summary: entry, meta: { path: entry, ...(root !== undefined ? { root } : {}), title: a.title ?? entry.split('/').pop() } };
    },
  };

  // ---------------------------------------------------------------------------------------------------------------- share_file
  const SHARE_MAX_MB = 64;
  const shareFile: ToolDef = {
    name: 'share_file',
    description:
      'Gives the user a file from the workspace as a download card under your message (a report, an export, a generated image or zip, a build artifact). ' +
      `Use it when the user asked for a file as the result; code changes are delivered through the repository, not through this tool. Max ${SHARE_MAX_MB} MB.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the repository root.' },
        description: { type: 'string', description: 'One short line about what the file is.' },
      },
      required: ['path'],
    },
    aliases: { path: ['file', 'file_path', 'filename'], description: ['note', 'caption'] },
    available,
    async run(raw, ctx) {
      const a = parseArgs('share_file', z.object({ path: filePath, description: z.string().trim().max(200).optional() }), raw);
      const s = scope(ctx);
      guard(ctx);
      const path = a.path.replace(/^\/work\//, '').replace(/^\.\//, '');
      const r = await withWorkspace(ctx, () => client.exec(s, `p=${shq(path)}; if [ -d "$p" ]; then echo DIR; elif [ -f "$p" ]; then stat -c %s -- "$p"; else echo NONE; fi`, 15, ctx.signal));
      const out = r.stdout.trim();
      if (out === 'NONE') throw new ToolError(`File not found: ${path}`);
      if (out === 'DIR') throw new ToolError(`${path} is a directory. Create an archive first (for example: zip -r out.zip ${path}) and share that file.`);
      const size = Number(out);
      if (!Number.isFinite(size)) throw new ToolError(`Could not read the size of ${path}.`);
      if (size > SHARE_MAX_MB * 1_048_576) throw new ToolError(`${path} is ${(size / 1_048_576).toFixed(1)} MB; the limit is ${SHARE_MAX_MB} MB. Compress it or share a smaller file.`);
      const name = path.split('/').pop() ?? path;
      return { output: `${name} (${size} bytes) is shared with the user as a download card under your message.`, summary: name, meta: { path, name, size, ...(a.description ? { description: a.description } : {}) } };
    },
  };

  return [bash, jobOutput, jobKill, read, write, edit, glob, grep, todo, preview, shareFile];
}
