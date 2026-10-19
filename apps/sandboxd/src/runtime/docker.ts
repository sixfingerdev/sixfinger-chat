import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import { capture } from './capture.ts';
import { SandboxError, type CodeProfile, type ExecOptions, type ExecResult, type HelperOptions, type Runtime } from './types.ts';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

const UID = '1000:1000';
const LABEL = 'sixfinger.sandbox=1';
const CODE_LABEL = 'sixfinger.code=1';

/** `docker run` argümanları. Saf fonksiyon: testlerde bayrakların yerinde olduğunu doğrularız. */
export function buildRunArgs(cfg: Config, name: string, networkMode: 'none' | 'restricted'): string[] {
  const args = [
    'run', '-d',
    '--name', name,
    '--label', LABEL,
    '--hostname', 'sandbox',
    '--init',
    '--user', UID,
    // Ayrıcalıkları kıs
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    // Yazılabilir alanlar RAM'de ve sert sınırlı (SD karta yazılmaz, disk dolduramaz)
    '--tmpfs', `/work:rw,nosuid,nodev,size=${cfg.WORK_MB}m,uid=1000,gid=1000,mode=0755`,
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${cfg.TMP_MB}m,uid=1000,gid=1000,mode=1777`,
    // Kaynak sınırları
    '--memory', `${cfg.MEM_MB}m`,
    '--memory-swap', `${cfg.MEM_MB}m`,
    '--cpus', String(cfg.CPUS),
    '--pids-limit', String(cfg.PIDS),
    '--ulimit', 'nofile=1024:1024',
    '--ulimit', `fsize=${cfg.WORK_MB * 1024 * 1024}`,
    '--ulimit', 'core=0',
    // Günlük tutma (diske yazma)
    '--log-driver', 'none',
    '--restart', 'no',
    '--stop-timeout', '1',
    '--workdir', '/work',
    '--env', 'HOME=/work',
    '--env', 'LANG=C.UTF-8',
  ];
  if (networkMode === 'none') {
    args.push('--network', 'none');
  } else {
    args.push('--network', cfg.SANDBOX_NETWORK_NAME);
    for (const dns of cfg.dnsServers) args.push('--dns', dns);
  }
  args.push(cfg.SANDBOX_IMAGE, 'sleep', 'infinity');
  return args;
}

export function buildExecArgs(name: string, argv: string[], timeoutMs: number): string[] {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return ['exec', '-i', '-u', UID, '-w', '/work', name, 'timeout', '-k', '2', String(seconds), ...argv];
}

/** Ortak güvenlik bayrakları (Code konteyneri ve yardımcı konteynerler için). */
const hardening = ['--user', UID, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--log-driver', 'none', '--ulimit', 'core=0'];

const networkArgs = (p: CodeProfile): string[] => (p.network === 'proxy' && p.networkName ? ['--network', p.networkName] : ['--network', 'none']);

/**
 * Code konteyneri: çalışma alanı DİSKTEN bind-mount edilir (kalıcı), kök dosya sistemi salt okunur, internet yalnızca iç ağdaki
 * kimlik doğrulamalı proxy üzerinden. Kullanıcı ortam değişkenlerinin değerleri argümanlara YAZILMAZ (`--env ANAHTAR`, değer süreç
 * ortamından okunur); proxy adresi sır değildir ama kimlik bilgisi içerir, bu yüzden o da ortamdan verilir.
 */
export function buildCodeRunArgs(cfg: Config, name: string, p: CodeProfile): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { ...p.env };
  const args = [
    'run', '-d',
    '--name', name,
    '--label', LABEL,
    '--label', CODE_LABEL,
    '--hostname', 'sandbox',
    '--init',
    ...hardening,
    '--mount', `type=bind,src=${p.hostDir},dst=/work`,
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${p.tmpMb}m,uid=1000,gid=1000,mode=1777`,
    '--memory', `${p.memMb}m`,
    '--memory-swap', `${p.memMb}m`,
    '--cpus', String(p.cpus),
    '--pids-limit', String(p.pids),
    '--ulimit', 'nofile=4096:4096',
    '--ulimit', `fsize=${p.fsizeBytes}`,
    '--restart', 'no',
    '--stop-timeout', '1',
    '--workdir', '/work',
    '--env', 'HOME=/work',
    '--env', 'LANG=C.UTF-8',
    // Önbellekler RAM'deki /tmp'ye: çalışma alanı diskini şişirmez.
    '--env', 'npm_config_cache=/tmp/.npm',
    '--env', 'PIP_CACHE_DIR=/tmp/.pip',
    // /tmp küçük bir RAM diskidir (büyük tekerlekler sığmaz): geçici dosyalar çalışma alanında (kotaya sayılır), pip önbelleği kapalı.
    '--env', 'TMPDIR=/work/.sixfinger/tmp',
    '--env', 'PIP_NO_CACHE_DIR=1',
    // `df` ana makinenin diskini değil bu kotayı gösterir (sandbox/df-quota).
    '--env', `SF_DISK_QUOTA_MB=${p.diskMb}`,
    '--env', 'YARN_CACHE_FOLDER=/tmp/.yarn',
    '--env', 'CI=1',
    '--env', 'GIT_TERMINAL_PROMPT=0',
    ...networkArgs(p),
  ];
  if (p.network === 'proxy' && p.proxyUrl) {
    env.HTTP_PROXY = env.HTTPS_PROXY = env.http_proxy = env.https_proxy = p.proxyUrl;
    args.push('--env', 'HTTP_PROXY', '--env', 'HTTPS_PROXY', '--env', 'http_proxy', '--env', 'https_proxy', '--env', 'NO_PROXY=localhost,127.0.0.1,::1', '--env', 'no_proxy=localhost,127.0.0.1,::1');
  }
  for (const k of Object.keys(p.env)) args.push('--env', k);
  args.push(cfg.SANDBOX_IMAGE, 'sleep', 'infinity');
  return { args, env };
}

/** Tek seferlik yardımcı (ör. token'lı `git clone`): çalışma alanı bağlı, iş bitince silinir; token yalnızca süreç ortamındadır. */
export function buildHelperArgs(cfg: Config, p: CodeProfile, secretKeys: string[], argv: string[], readOnly = false): string[] {
  const args = [
    'run', '--rm', '-i',
    '--label', LABEL,
    ...hardening,
    '--mount', `type=bind,src=${p.hostDir},dst=/work${readOnly ? ',readonly' : ''}`,
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${Math.min(p.tmpMb, 128)}m,uid=1000,gid=1000,mode=1777`,
    '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '128',
    '--workdir', '/work',
    '--env', 'HOME=/tmp', '--env', 'GIT_TERMINAL_PROMPT=0',
    ...networkArgs(p),
  ];
  if (p.network === 'proxy' && p.proxyUrl) args.push('--env', 'HTTP_PROXY', '--env', 'HTTPS_PROXY', '--env', 'http_proxy', '--env', 'https_proxy');
  for (const k of secretKeys) args.push('--env', k);
  args.push('--entrypoint', argv[0]!, cfg.SANDBOX_IMAGE, ...argv.slice(1));
  return args;
}

export class DockerRuntime implements Runtime {
  readonly name = 'docker';
  /** Güvenlik duvarı doğrulaması başarısız olursa ağ kapatılır. */
  networkMode: 'none' | 'restricted';

  constructor(
    private readonly cfg: Config,
    private readonly log: Log,
  ) {
    this.networkMode = cfg.SANDBOX_NETWORK;
    mkdirSync(cfg.SANDBOX_DATA_DIR, { recursive: true, mode: 0o700 });
  }

  private cname = (id: string) => `sf-${id}`;
  private snap = (id: string) => join(this.cfg.SANDBOX_DATA_DIR, `${id}.tgz`);

  private docker(args: string[], timeoutMs = 20_000, stdin?: Buffer, maxOutput = 256 * 1024, env?: Record<string, string>) {
    return capture('docker', args, { timeoutMs, maxOutput, stdin, env: env ? { ...process.env, ...env } : undefined });
  }

  private async state(name: string): Promise<'running' | 'stopped' | 'missing'> {
    const r = await this.docker(['inspect', '-f', '{{.State.Running}}', name], 10_000);
    if (r.exitCode !== 0) return 'missing';
    return r.stdout.trim() === 'true' ? 'running' : 'stopped';
  }

  async ensureNetwork(): Promise<void> {
    const have = await this.docker(['network', 'inspect', this.cfg.SANDBOX_NETWORK_NAME], 10_000);
    if (have.exitCode === 0) return;
    const r = await this.docker(
      ['network', 'create', '--driver', 'bridge', '--subnet', this.cfg.SANDBOX_SUBNET, '--opt', 'com.docker.network.bridge.enable_icc=false', this.cfg.SANDBOX_NETWORK_NAME],
      15_000,
    );
    if (r.exitCode !== 0) throw new SandboxError(`Sandbox ağı oluşturulamadı: ${r.stderr.slice(0, 200)}`, 'internal');
  }

  async ensure(id: string, profile?: CodeProfile): Promise<void> {
    const name = this.cname(id);
    const st = await this.state(name);
    if (st === 'running') return;
    if (st === 'stopped') await this.docker(['rm', '-f', name], 15_000);
    if (profile) {
      mkdirSync(profile.dir, { recursive: true, mode: 0o700 });
      const { args, env } = buildCodeRunArgs(this.cfg, name, profile);
      const run = await this.docker(args, 40_000, undefined, 256 * 1024, env);
      if (run.exitCode !== 0) throw new SandboxError(`Code sandbox başlatılamadı: ${run.stderr.slice(0, 300)}`, 'internal');
      return;
    }
    if (this.networkMode === 'restricted') await this.ensureNetwork();

    const run = await this.docker(buildRunArgs(this.cfg, name, this.networkMode), 30_000);
    if (run.exitCode !== 0) throw new SandboxError(`Sandbox başlatılamadı: ${run.stderr.slice(0, 300)}`, 'internal');

    const snap = this.snap(id);
    if (existsSync(snap)) {
      const restore = await this.docker(['exec', '-i', '-u', UID, '-w', '/work', name, 'tar', 'xzf', '-', '-C', '/work'], 30_000, readFileSync(snap));
      if (restore.exitCode !== 0) this.log.warn({ id, err: restore.stderr.slice(0, 200) }, 'anlık görüntü geri yüklenemedi');
    }
  }

  async exec(id: string, opts: ExecOptions): Promise<ExecResult> {
    const name = this.cname(id);
    const r = await capture('docker', buildExecArgs(name, opts.argv, opts.timeoutMs), {
      stdin: opts.stdin,
      // `timeout` komutu içeride öldürür; bu dış sınır docker istemcisi takılırsa devreye girer.
      timeoutMs: opts.timeoutMs + 6_000,
      maxOutput: opts.maxOutput,
      // İstemci öldürülünce konteynerdeki süreçler kalabilir: hepsini sonlandır.
      onTimeout: () => void this.docker(['exec', '-u', UID, name, 'sh', '-c', 'kill -9 -1'], 8_000),
    });
    // timeout: 124 (TERM ile), 137 (KILL ile)
    const timedOut = r.timedOut || ((r.exitCode === 124 || r.exitCode === 137) && r.durationMs >= opts.timeoutMs * 0.9);
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, truncated: r.truncated, timedOut, durationMs: r.durationMs, stdoutBuf: r.stdoutBuf };
  }

  async helper(opts: HelperOptions): Promise<ExecResult> {
    const secretKeys = Object.keys(opts.secretEnv ?? {});
    const env: Record<string, string> = { ...(opts.secretEnv ?? {}) };
    if (opts.profile.network === 'proxy' && opts.profile.proxyUrl) env.HTTP_PROXY = env.HTTPS_PROXY = env.http_proxy = env.https_proxy = opts.profile.proxyUrl;
    const r = await capture('docker', buildHelperArgs(this.cfg, opts.profile, secretKeys, opts.argv, opts.readOnly), {
      timeoutMs: opts.timeoutMs,
      maxOutput: opts.maxOutput,
      env: { ...process.env, ...env },
    });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, truncated: r.truncated, timedOut: r.timedOut, durationMs: r.durationMs };
  }

  async release(id: string, { snapshot }: { snapshot: boolean }): Promise<void> {
    const name = this.cname(id);
    if (snapshot && (await this.state(name)) === 'running') {
      const max = this.cfg.SNAPSHOT_MAX_MB * 1024 * 1024;
      const tar = await capture('docker', ['exec', '-u', UID, '-w', '/work', name, 'tar', 'czf', '-', '-C', '/work', '.'], { timeoutMs: 30_000, maxOutput: max });
      if (tar.exitCode === 0 && !tar.truncated && tar.stdoutBuf.length > 32) {
        const tmp = `${this.snap(id)}.tmp`;
        writeFileSync(tmp, tar.stdoutBuf, { mode: 0o600 });
        renameSync(tmp, this.snap(id));
      } else if (tar.truncated) {
        this.log.warn({ id }, 'çalışma alanı anlık görüntü sınırını aştı; kaydedilmedi');
        rmSync(this.snap(id), { force: true });
      }
    }
    await this.docker(['rm', '-f', name], 15_000);
  }

  async destroy(id: string): Promise<void> {
    await this.docker(['rm', '-f', this.cname(id)], 15_000);
    rmSync(this.snap(id), { force: true });
  }

  async list(): Promise<string[]> {
    const r = await this.docker(['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}'], 10_000);
    return r.stdout.split('\n').map((s) => s.trim()).filter((n) => n.startsWith('sf-s')).map((n) => n.slice(3));
  }

  async listCode(): Promise<string[]> {
    const r = await this.docker(['ps', '-a', '--filter', `label=${CODE_LABEL}`, '--format', '{{.Names}}'], 10_000);
    return r.stdout.split('\n').map((s) => s.trim()).filter((n) => n.startsWith('sf-c')).map((n) => n.slice(3));
  }

  async health(): Promise<{ ok: boolean; details: Record<string, unknown> }> {
    const v = await this.docker(['version', '--format', '{{.Server.Version}}'], 10_000);
    return { ok: v.exitCode === 0, details: { docker: v.stdout.trim() || v.stderr.slice(0, 120), network: this.networkMode, image: this.cfg.SANDBOX_IMAGE } };
  }

  /**
   * "restricted" ağda güvenlik duvarının gerçekten çalıştığını sınar: sandbox'tan ana makineye (ağ geçidi)
   * ve yerel ağa bağlanmayı dener. Herhangi biri başarılıysa DEĞİL döner (çağıran ağı kapatır).
   */
  async verifyIsolation(extraTargets: string[] = []): Promise<{ ok: boolean; reachable: string[] }> {
    await this.ensureNetwork();
    const gw = await this.docker(['network', 'inspect', '-f', '{{(index .IPAM.Config 0).Gateway}}', this.cfg.SANDBOX_NETWORK_NAME], 10_000);
    const gateway = gw.stdout.trim();
    const targets = [...(gateway ? ['22', '80', '8787', String(this.cfg.PORT), '5432'].map((p) => `${gateway}:${p}`) : []), '192.168.0.1:80', '192.168.1.1:80', '10.0.0.1:80', '172.17.0.1:80', ...extraTargets];
    const script = targets.map((t) => { const [h, p] = t.split(':'); return `nc -z -w 2 ${h} ${p} && echo "REACHED ${t}"`; }).join('; ');
    const probe = await this.docker(
      ['run', '--rm', '--network', this.cfg.SANDBOX_NETWORK_NAME, '--user', UID, '--cap-drop', 'ALL', '--memory', '64m', '--pids-limit', '32', '--log-driver', 'none', '--entrypoint', 'sh', this.cfg.SANDBOX_IMAGE, '-c', `${script}; true`],
      60_000,
    );
    const reachable = probe.stdout.split('\n').filter((l) => l.startsWith('REACHED ')).map((l) => l.slice(8));
    return { ok: probe.exitCode === 0 && reachable.length === 0, reachable };
  }
}
