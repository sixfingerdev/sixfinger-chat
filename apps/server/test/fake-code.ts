import { ToolError } from '../src/services/tools/errors.ts';
import { FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient } from '../src/services/tools/code-client.ts';
import type { ExecOutcome } from '../src/services/tools/sandbox.ts';

/** Bellekte çalışan sahte sandboxd Code istemcisi (ajan döngüsü testleri için). */
export function fakeCode(initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial));
  const base = new Map(Object.entries(initial));
  /** Son commit'in içeriği (commit yalnızca ona göre değişiklik varsa atılır; `changes` ise başlangıca göre hesaplanır). */
  const head = new Map(Object.entries(initial));
  const state = {
    prepares: [] as Array<Record<string, unknown>>,
    execs: [] as string[],
    commits: [] as string[],
    pushes: [] as Array<{ token: string; sha: string; force: boolean }>,
    failPush: null as string | null,
    failPrepare: null as string | null,
    needPrepare: false,
    execImpl: (_c: string): Partial<ExecOutcome & { diskUsedMb: number }> => ({}),
    delayMs: 0,
    changesCalls: 0,
    checkpoints: 0,
    /** Sahte dev-server: port → istek işleyici (null: dinleyen yok). */
    servers: new Map<number, (r: { method: string; path: string; headers: Record<string, string>; body?: Buffer }) => { status: number; headers?: Array<[string, string]>; body: Buffer | string }>(),
    httpCalls: [] as Array<{ port: number; method: string; path: string; headers: Record<string, string> }>,
    uploads: [] as Array<{ path: string; bytes: number }>,
  };
  /** İkili dosyalar (ham okuma/indirme testleri için). */
  const bin = new Map<string, Buffer>();
  const sleep = () => (state.delayMs ? new Promise((r) => setTimeout(r, state.delayMs)) : Promise.resolve());
  const lines = (t: string) => (t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0));
  const diff = (from = base) => {
    const files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number }> = [];
    for (const [p, c] of fs) {
      const b = from.get(p);
      if (b === undefined) files.push({ path: p, status: 'added', additions: lines(c), deletions: 0 });
      else if (b !== c) files.push({ path: p, status: 'modified', additions: Math.max(1, lines(c) - lines(b) + 1), deletions: 1 });
    }
    for (const p of from.keys()) if (!fs.has(p)) files.push({ path: p, status: 'deleted', additions: 0, deletions: lines(from.get(p)!) });
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
      // Ajanın kendi `git commit -m "..."` komutu: sahte depoda commit atar (ajan commit ederse dal ucu ilerler).
      if (/\bgit\s+commit\b/.test(command) && diff(head).length) {
        const m = /-m\s+(?:"([^"]*)"|'([^']*)')/.exec(command);
        state.commits.push(m?.[1] ?? m?.[2] ?? 'commit');
        head.clear();
        for (const [p, c] of fs) head.set(p, c);
      }
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
      const n = state.commits.length;
      return {
        files, additions: files.reduce((x, f) => x + f.additions, 0), deletions: files.reduce((x, f) => x + f.deletions, 0), baseSha: 'b'.repeat(40),
        headSha: n ? `${n}`.padStart(40, 'c') : 'b'.repeat(40), ahead: n, uncommitted: diff(head).length, subject: (state.commits[n - 1] ?? '').split('\n')[0]!,
      };
    },
    async checkpoint() {
      state.checkpoints++;
      const n = state.commits.length;
      return { head: n ? `${n}`.padStart(40, 'c') : 'b'.repeat(40), snapshot: `${state.checkpoints}`.padStart(40, 'd') };
    },
    async archive() {
      return Buffer.from('1f8b0800', 'hex');
    },
    async push(_s, token, _signal, opts) {
      if (state.needPrepare) throw new NotPreparedError();
      if (state.failPush) throw new ToolError(state.failPush);
      const sha = state.commits.length ? `${state.commits.length}`.padStart(40, 'c') : 'a'.repeat(40);
      state.pushes.push({ token, sha, force: Boolean(opts?.force) });
      return { sha, branch: 'sixfinger/test', output: '' };
    },
    async raw(_s, path, maxMb) {
      if (state.needPrepare) throw new NotPreparedError();
      const data = bin.get(path) ?? (fs.has(path) ? Buffer.from(fs.get(path)!) : undefined);
      if (!data) {
        if ([...fs.keys()].some((k) => k.startsWith(`${path}/`))) throw new IsDirectoryError();
        throw new FileNotFoundError();
      }
      if (data.length > maxMb * 1_048_576) throw new ToolError(`Dosya çok büyük (en fazla ${maxMb} MB).`);
      return data;
    },
    async ports() {
      return [...state.servers.keys()];
    },
    async http(_s, r) {
      if (state.needPrepare) throw new NotPreparedError();
      state.httpCalls.push({ port: r.port, method: r.method, path: r.path, headers: r.headers });
      const h = state.servers.get(r.port);
      if (!h) throw new FileNotFoundError(`Port ${r.port} üzerinde dinleyen bir sunucu yok.`);
      const o = h({ method: r.method, path: r.path, headers: r.headers, body: r.body });
      return { status: o.status, headers: o.headers ?? [], body: Buffer.isBuffer(o.body) ? o.body : Buffer.from(o.body) };
    },
    async upload(_s, path, data) {
      state.uploads.push({ path, bytes: data.length });
      bin.set(path, data);
      return { bytes: data.length };
    },
    async usage() {
      return { diskUsedMb: 3, diskMb: 512, running: true };
    },
    async destroy() {},
  };
  return { client, fs, bin, state };
}
