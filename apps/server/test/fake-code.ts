import { ToolError } from '../src/services/tools/errors.ts';
import { FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient } from '../src/services/tools/code-client.ts';
import type { ExecOutcome } from '../src/services/tools/sandbox.ts';

/** Bellekte çalışan sahte sandboxd Code istemcisi (ajan döngüsü testleri için). */
export function fakeCode(initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial));
  const base = new Map(Object.entries(initial));
  const state = {
    prepares: [] as Array<Record<string, unknown>>,
    execs: [] as string[],
    commits: [] as string[],
    pushes: [] as Array<{ token: string; sha: string }>,
    failPush: null as string | null,
    failPrepare: null as string | null,
    needPrepare: false,
    execImpl: (_c: string): Partial<ExecOutcome & { diskUsedMb: number }> => ({}),
    delayMs: 0,
    changesCalls: 0,
  };
  const sleep = () => (state.delayMs ? new Promise((r) => setTimeout(r, state.delayMs)) : Promise.resolve());
  const lines = (t: string) => (t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0));
  const diff = () => {
    const files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number }> = [];
    for (const [p, c] of fs) {
      const b = base.get(p);
      if (b === undefined) files.push({ path: p, status: 'added', additions: lines(c), deletions: 0 });
      else if (b !== c) files.push({ path: p, status: 'modified', additions: Math.max(1, lines(c) - lines(b) + 1), deletions: 1 });
    }
    for (const p of base.keys()) if (!fs.has(p)) files.push({ path: p, status: 'deleted', additions: 0, deletions: lines(base.get(p)!) });
    return files;
  };
  const client: CodeSandboxClient = {
    async prepare(a) {
      state.prepares.push(a as unknown as Record<string, unknown>);
      if (state.failPrepare) throw new Error(state.failPrepare);
      state.needPrepare = false;
      return { cloned: state.prepares.length === 1, setupRan: false, setupOk: null, setupOutput: '', baseSha: 'b'.repeat(40), branch: a.workBranch, diskUsedMb: 3, diskMb: a.diskMb };
    },
    async exec(_s, command) {
      if (state.needPrepare) throw new NotPreparedError();
      state.execs.push(command);
      await sleep();
      return { exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, durationMs: 150, diskUsedMb: 3, ...state.execImpl(command) };
    },
    async read(_s, path) {
      if (state.needPrepare) throw new NotPreparedError();
      if (fs.has(path)) return { content: fs.get(path)!, truncated: false };
      if ([...fs.keys()].some((k) => k.startsWith(`${path}/`))) throw new IsDirectoryError();
      throw new FileNotFoundError();
    },
    async write(_s, path, content) {
      if (state.needPrepare) throw new NotPreparedError();
      await sleep();
      fs.set(path, content);
      return { bytes: content.length, diskUsedMb: 3 };
    },
    async glob() {
      return { files: [...fs.keys()].sort(), truncated: false };
    },
    async grep() {
      return { lines: [], truncated: false };
    },
    async changes() {
      state.changesCalls++;
      const files = diff();
      return { files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0), baseSha: 'b'.repeat(40) };
    },
    async commit(_s, message) {
      if (!diff().length) return { sha: null };
      state.commits.push(message);
      return { sha: `${state.commits.length}`.padStart(40, 'c') };
    },
    async push(_s, token) {
      if (state.needPrepare) throw new NotPreparedError();
      if (state.failPush) throw new ToolError(state.failPush);
      const sha = state.commits.length ? `${state.commits.length}`.padStart(40, 'c') : 'a'.repeat(40);
      state.pushes.push({ token, sha });
      return { sha, branch: 'sixfinger/test', output: '' };
    },
    async usage() {
      return { diskUsedMb: 3, diskMb: 512, running: true };
    },
    async destroy() {},
  };
  return { client, fs, state };
}
