import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from './capture.ts';
import type { ExecOptions, ExecResult, Runtime } from './types.ts';

/**
 * YALNIZCA geliştirme ve testler içindir: komutları doğrudan ana makinede, geçici bir klasörde çalıştırır.
 * Hiçbir yalıtım YOKTUR. Üretimde SANDBOX_RUNTIME=docker kullan.
 */
export class LocalRuntime implements Runtime {
  readonly name = 'local-unsafe';
  private root: string;

  constructor(root = join(tmpdir(), `sf-local-sandbox-${process.pid}`)) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private dir = (id: string) => join(this.root, id);

  async ensure(id: string): Promise<void> {
    mkdirSync(this.dir(id), { recursive: true });
  }

  exec(id: string, opts: ExecOptions): Promise<ExecResult> {
    const [cmd, ...args] = opts.argv;
    return capture(cmd!, args, {
      cwd: this.dir(id),
      env: { PATH: process.env.PATH, HOME: this.dir(id), LANG: 'C.UTF-8' },
      stdin: opts.stdin,
      timeoutMs: opts.timeoutMs,
      maxOutput: opts.maxOutput,
    });
  }

  async release(): Promise<void> {
    /* yerel çalıştırıcıda dosyalar yerinde kalır */
  }

  async destroy(id: string): Promise<void> {
    rmSync(this.dir(id), { recursive: true, force: true });
  }

  async list(): Promise<string[]> {
    return readdirSync(this.root);
  }

  async health() {
    return { ok: true, details: { runtime: 'local-unsafe', root: this.root } };
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
