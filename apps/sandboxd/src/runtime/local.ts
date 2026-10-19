import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from './capture.ts';
import type { CodeProfile, ExecOptions, ExecResult, HelperOptions, Runtime } from './types.ts';

/**
 * YALNIZCA geliştirme ve testler içindir: komutları doğrudan ana makinede, geçici bir klasörde çalıştırır.
 * Hiçbir yalıtım YOKTUR. Üretimde SANDBOX_RUNTIME=docker kullan.
 */
export class LocalRuntime implements Runtime {
  readonly name = 'local-unsafe';
  private root: string;
  /** Code oturumlarında çalışma dizini profilden gelir (kalıcı). */
  private codeDirs = new Map<string, CodeProfile>();

  constructor(root = join(tmpdir(), `sf-local-sandbox-${process.pid}`)) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private dir = (id: string) => this.codeDirs.get(id)?.dir ?? join(this.root, id);

  async ensure(id: string, profile?: CodeProfile): Promise<void> {
    if (profile) this.codeDirs.set(id, profile);
    mkdirSync(this.dir(id), { recursive: true });
  }

  /** Test için: yardımcı konteyner yerine aynı komutu çalışma dizininde çalıştırır. */
  helper(opts: HelperOptions): Promise<ExecResult> {
    const [cmd, ...args] = opts.argv;
    return capture(cmd!, args, {
      cwd: opts.profile.dir,
      env: { PATH: process.env.PATH, HOME: opts.profile.dir, LANG: 'C.UTF-8', ...opts.secretEnv },
      timeoutMs: opts.timeoutMs,
      maxOutput: opts.maxOutput,
    });
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
    this.codeDirs.delete(id);
  }

  async list(): Promise<string[]> {
    return readdirSync(this.root).filter((n) => n.startsWith('s'));
  }

  async listCode(): Promise<string[]> {
    return [];
  }

  async health() {
    return { ok: true, details: { runtime: 'local-unsafe', root: this.root } };
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
