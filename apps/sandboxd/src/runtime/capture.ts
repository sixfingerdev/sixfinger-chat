import { spawn } from 'node:child_process';
import type { ExecResult } from './types.ts';

export interface CaptureResult extends ExecResult {
  /** Ham stdout (ikili çıktılar, ör. tar için). */
  stdoutBuf: Buffer;
}

export interface CaptureOptions {
  stdin?: Buffer;
  timeoutMs: number;
  maxOutput: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Zaman aşımında çağrılır (ör. konteyner içindeki süreçleri öldürmek için). */
  onTimeout?: () => void | Promise<void>;
}

/** Bir süreci çalıştırır; çıktıyı sınırlar, zaman aşımında öldürür. Hata fırlatmaz: sonuç her zaman döner. */
export function capture(cmd: string, args: string[], opts: CaptureOptions): Promise<CaptureResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL'); // süreç grubu
      } catch {
        child.kill('SIGKILL');
      }
    };

    const push = (chunk: Buffer, list: Buffer[], size: number): number => {
      const room = opts.maxOutput - size;
      if (room <= 0) {
        truncated = true;
        return size;
      }
      if (chunk.length > room) {
        list.push(chunk.subarray(0, room));
        truncated = true;
        return size + room;
      }
      list.push(chunk);
      return size + chunk.length;
    };

    child.stdout.on('data', (c: Buffer) => {
      outSize = push(c, out, outSize);
      // Sınırın çok üstünde çıktı basan süreci erken durdur (yes > /dev/null benzeri döngüler).
      if (outSize >= opts.maxOutput && truncated) killTree();
    });
    child.stderr.on('data', (c: Buffer) => {
      errSize = push(c, err, errSize);
      if (errSize >= opts.maxOutput && truncated) killTree();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      void Promise.resolve(opts.onTimeout?.()).catch(() => {});
      killTree();
    }, opts.timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuf = Buffer.concat(out);
      resolve({
        exitCode,
        stdoutBuf,
        stdout: stdoutBuf.toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on('error', (e) => {
      err.push(Buffer.from(`çalıştırılamadı: ${e.message}`));
      finish(null);
    });
    child.on('close', (code) => finish(code));

    child.stdin.on('error', () => {});
    if (opts.stdin) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}
