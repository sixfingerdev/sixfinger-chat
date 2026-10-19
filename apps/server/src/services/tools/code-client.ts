import { ToolError } from './errors.ts';
import type { ExecOutcome } from './sandbox.ts';

/** sandboxd'nin "çalışma alanı hazır değil" (409) yanıtı: çağıran prepare edip bir kez daha dener. */
export class NotPreparedError extends ToolError {
  constructor() {
    super('Workspace is not ready.');
    this.name = 'NotPreparedError';
  }
}

/** Dosya yok (sandboxd `not_found`). */
export class FileNotFoundError extends ToolError {
  constructor(message = 'File not found.') {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

/** Yol bir klasör (sandboxd `is_directory`). */
export class IsDirectoryError extends ToolError {
  constructor(message = 'Path is a directory.') {
    super(message);
    this.name = 'IsDirectoryError';
  }
}

export interface CodeScope {
  user: string;
  session: string;
}

export interface PrepareArgs extends CodeScope {
  repo: string;
  baseBranch: string;
  workBranch: string;
  token?: string;
  author?: { name: string; email: string };
  network: { mode: 'none' | 'trusted' | 'full' | 'custom'; domains: string[] };
  diskMb: number;
  setupScript: string;
  env: Record<string, string>;
}

export interface PrepareOutcome {
  cloned: boolean;
  setupRan: boolean;
  setupOk: boolean | null;
  setupOutput: string;
  baseSha: string;
  branch: string;
  diskUsedMb: number;
  diskMb: number;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}
export interface ChangesOutcome {
  files: ChangedFile[];
  additions: number;
  deletions: number;
  baseSha: string;
  /** Çalışma branch'inin ucu. */
  headSha: string;
  /** Başlangıç commit'inden bu yana atılan commit sayısı (ajan commit atar). */
  ahead: number;
  /** Commit edilmemiş dosya sayısı. */
  uncommitted: number;
  /** Son commit'in başlığı (ahead > 0 ise). */
  subject: string;
}

export interface SandboxHttpRequest {
  port: number;
  method: string;
  /** `/` ile başlayan yol + sorgu. */
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
}
export interface SandboxHttpResponse {
  status: number;
  headers: Array<[string, string]>;
  body: Buffer;
}

/** sandboxd'nin Code uçlarıyla konuşan istemci (ana uygulamanın Docker'a erişimi yoktur). */
export interface CodeSandboxClient {
  prepare(a: PrepareArgs, signal: AbortSignal): Promise<PrepareOutcome>;
  exec(s: CodeScope, command: string, timeoutSeconds: number, signal: AbortSignal): Promise<ExecOutcome & { diskUsedMb: number }>;
  read(s: CodeScope, path: string, signal: AbortSignal): Promise<{ content: string; truncated: boolean }>;
  write(s: CodeScope, path: string, content: string, signal: AbortSignal): Promise<{ bytes: number; diskUsedMb: number }>;
  glob(s: CodeScope, a: { pattern: string; path?: string; limit?: number }, signal: AbortSignal): Promise<{ files: string[]; truncated: boolean }>;
  grep(
    s: CodeScope,
    a: { pattern: string; path?: string; include?: string; literal?: boolean; caseSensitive?: boolean; limit?: number },
    signal: AbortSignal,
  ): Promise<{ lines: string[]; truncated: boolean }>;
  changes(s: CodeScope, signal: AbortSignal): Promise<ChangesOutcome>;
  /** Geri sarma noktası: o anki çalışma alanı (commit edilmemişler dahil) branch'e dokunmadan saklanır. */
  checkpoint(s: CodeScope, signal: AbortSignal): Promise<{ head: string; snapshot: string }>;
  /** Son commit'i GitHub'a iter (token yalnızca sandboxd'nin tek seferlik yardımcı konteynerinde kullanılır). */
  push(s: CodeScope, token: string, signal: AbortSignal, opts?: { force?: boolean }): Promise<{ sha: string; branch: string; output: string }>;
  /** Çalışma alanının (node_modules ve .git hariç) tar.gz arşivi. */
  archive(s: CodeScope, signal: AbortSignal): Promise<Buffer>;
  /** Dosyanın ham baytları (önizleme, indirme). `maxMb` aşılırsa hata. */
  raw(s: CodeScope, path: string, maxMb: number, signal: AbortSignal): Promise<Buffer>;
  /** Sandbox içinde dinleyen portlar. */
  ports(s: CodeScope, signal: AbortSignal): Promise<number[]>;
  /** Sandbox içindeki bir dev-server'a (127.0.0.1:port) tek HTTP isteği. */
  http(s: CodeScope, r: SandboxHttpRequest, signal: AbortSignal): Promise<SandboxHttpResponse>;
  /** İkili dosya yazar (kullanıcı yüklemeleri). */
  upload(s: CodeScope, path: string, data: Buffer, signal: AbortSignal): Promise<{ bytes: number }>;
  usage(s: CodeScope, signal: AbortSignal): Promise<{ diskUsedMb: number; diskMb: number; running: boolean }>;
  destroy(s: CodeScope): Promise<void>;
}

export function createCodeClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): CodeSandboxClient {
  async function call<T>(path: string, body: object, signal: AbortSignal, timeoutMs: number, raw = false): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/code/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ToolError('The sandbox service is unreachable.');
    }
    if (res.status === 204) return undefined as T;
    if (res.ok) return (raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T;
    let message = '';
    let code = '';
    try {
      const e = ((await res.json()) as { error?: { message?: string; code?: string } }).error;
      message = e?.message ?? '';
      code = e?.code ?? '';
    } catch {
      /* gövde yok */
    }
    if (res.status === 409 && code === 'not_prepared') throw new NotPreparedError();
    if (code === 'not_found') throw new FileNotFoundError(message);
    if (code === 'is_directory') throw new IsDirectoryError(message);
    if (res.status === 503) throw new ToolError(message || 'The sandbox is busy right now. Try again in a few seconds.');
    if (res.status === 401) throw new ToolError('The sandbox is misconfigured.');
    throw new ToolError(message || `Sandbox error (${res.status}).`);
  }

  const who = (s: CodeScope) => ({ user: s.user, session: s.session });
  return {
    prepare: (a, signal) =>
      call(
        'prepare',
        {
          user: a.user, session: a.session, repo: a.repo, base_branch: a.baseBranch, work_branch: a.workBranch, token: a.token, author: a.author,
          network: a.network, disk_mb: a.diskMb, setup_script: a.setupScript, env: a.env,
        },
        signal,
        20 * 60_000,
      ),
    exec: (s, command, timeoutSeconds, signal) => call('exec', { ...who(s), command, timeout_seconds: timeoutSeconds }, signal, (timeoutSeconds + 60) * 1000),
    read: (s, path, signal) => call('read', { ...who(s), path }, signal, 40_000),
    write: (s, path, content, signal) => call('write', { ...who(s), path, content }, signal, 60_000),
    glob: (s, a, signal) => call('glob', { ...who(s), ...a }, signal, 60_000),
    grep: (s, a, signal) => call('grep', { ...who(s), pattern: a.pattern, path: a.path, include: a.include, literal: a.literal, case_sensitive: a.caseSensitive, limit: a.limit }, signal, 60_000),
    changes: (s, signal) => call('changes', who(s), signal, 90_000),
    checkpoint: (s, signal) => call('checkpoint', who(s), signal, 90_000),
    push: (s, token, signal, opts) => call('push', { ...who(s), token, force: opts?.force }, signal, 5 * 60_000),
    archive: (s, signal) => call('archive', who(s), signal, 3 * 60_000, true),
    raw: (s, path, maxMb, signal) => call('raw', { ...who(s), path, max_mb: maxMb }, signal, 90_000, true),
    ports: async (s, signal) => (await call<{ ports: number[] }>('ports', who(s), signal, 20_000)).ports,
    http: async (s, r, signal) => {
      const o = await call<{ status: number; headers: Array<[string, string]>; body_base64: string }>(
        'http',
        { ...who(s), port: r.port, method: r.method, path: r.path, headers: r.headers, body_base64: r.body?.length ? r.body.toString('base64') : undefined },
        signal,
        45_000,
      );
      return { status: o.status, headers: o.headers, body: Buffer.from(o.body_base64, 'base64') };
    },
    upload: (s, path, data, signal) => call('write', { ...who(s), path, content: data.toString('base64'), encoding: 'base64' }, signal, 60_000),
    usage: (s, signal) => call('usage', who(s), signal, 120_000),
    destroy: (s) => call('destroy', who(s), new AbortController().signal, 60_000),
  };
}
