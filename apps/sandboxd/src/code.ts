import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { EgressPolicy, EgressProxy } from './egress.ts';
import { capture } from './runtime/capture.ts';
import { SandboxBusyError, SandboxError, type CodeProfile, type ExecResult, type Runtime } from './runtime/types.ts';
import { workPath } from './service.ts';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** Code çalışma alanı kimliği (`c` önekli: sohbet sandbox'larının `s` önekli kimliklerinden ayrılır). */
export const codeSessionId = (raw: string): string => `c${createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock(\/|$))[A-Za-z0-9._/-]{1,200}$/;

export interface PrepareRequest {
  user: string;
  session: string;
  repo: string;
  baseBranch: string;
  workBranch: string;
  /** GitHub erişim token'ı. Yalnızca ilk klonlamada gerekir; konteynere ASLA verilmez. */
  token?: string;
  network: EgressPolicy;
  /** Commit yazarı (kullanıcının GitHub kimliği). Verilmezse SixFinger Code. */
  author?: { name: string; email: string };
  diskMb: number;
  setupScript: string;
  env: Record<string, string>;
  /** Yalnızca local-unsafe (test): GitHub yerine yerel bir depo. */
  cloneUrl?: string;
}

export interface PrepareResult {
  cloned: boolean;
  setupRan: boolean;
  /** Kurulum betiği çalıştıysa çıkış kodu 0 mı; çalışmadıysa null. */
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
export interface Changes {
  files: ChangedFile[];
  additions: number;
  deletions: number;
  baseSha: string;
}

interface State {
  id: string;
  user: string;
  dir: string;
  profile: CodeProfile;
  req: Omit<PrepareRequest, 'token'>;
  envHash: string;
  running: boolean;
  lastUsed: number;
  busy: number;
  diskUsedMb: number;
  diskAt: number;
  /** Son `du` süresi: ucuzsa her işlemden sonra ölçülür, pahalıysa 10 sn'de bir. */
  measureMs: number;
  chain: Promise<unknown>;
}

/** Basit glob → RegExp: `**` (dizinler dahil), `*` / `?` (dizin ayracı hariç), `{a,b}`, `[abc]`. Yol `/` ile ayrılmış, köke göreli. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (c === ',' && braces > 0) out += '|';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end > i + 1) {
        out += `[${glob.slice(i + 1, end).replace(/\\/g, '\\\\')}]`;
        i = end;
      } else out += '\\[';
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  // `*.ts` gibi eğik çizgisiz kalıplar her dizinde dosya adına uygulanır (ripgrep/gitignore davranışı).
  return new RegExp(glob.includes('/') ? `^${out}$` : `^(?:.*/)?${out}$`);
}

const shortHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/** Bu komut diski doldurmuş bir çalışma alanında da çalışabilir mi? (kurtarma: temizlik komutları) */
const CLEANUP_CMD = /^\s*(rm|du|ls|df|find|git\s+(clean|gc|status|stash|reset))\b/;

const GIT_INIT_SCRIPT = `
set -e
mkdir -p .git/sixfinger
git config user.name "$2"
git config user.email "$3"
git config core.hooksPath /dev/null
if [ ! -f .git/sixfinger/base ]; then
  git rev-parse HEAD > .git/sixfinger/base
  git checkout -q -b "$1"
fi
# Çok sayıda dosya içeren bağımlılık/önbellek klasörleri izlenmesin (depo kendi .gitignore'unu tanımlamamış olabilir).
printf 'node_modules/\\n.venv/\\n__pycache__/\\n.cache/\\n.next/\\n.turbo/\\n' >> .git/info/exclude
touch .git/sixfinger/init
`;

export class CodeService {
  private states = new Map<string, State>();
  private reaper?: NodeJS.Timeout;

  constructor(
    private readonly cfg: Config,
    readonly runtime: Runtime,
    private readonly egress: EgressProxy | null,
    private readonly log: Log,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- yaşam döngüsü ----------
  async start(): Promise<void> {
    mkdirSync(this.root(), { recursive: true, mode: 0o700 });
    // Önceki çalışmadan kalan Code konteynerleri (proxy kimlikleri artık geçersiz): kapat; çalışma alanları diskte kalır.
    for (const id of await this.runtime.listCode().catch(() => [] as string[])) await this.runtime.release(id, { snapshot: false }).catch(() => {});
    this.reaper = setInterval(() => void this.reapIdle().catch((err) => this.log.error({ err }, 'Code boşta temizleme hatası')), 30_000);
    this.reaper.unref();
    void this.sweepWorkspaces().catch((err) => this.log.warn({ err }, 'çalışma alanı temizliği başarısız'));
  }

  async stop(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all([...this.states.values()].map((s) => this.release(s)));
  }

  stats() {
    const running = [...this.states.values()].filter((s) => s.running).length;
    return { known: this.states.size, running, maxContainers: this.cfg.CODE_MAX_CONTAINERS };
  }

  private root = () => join(this.cfg.CODE_DATA_DIR, 'workspaces');

  /** Boşta kalan Code konteynerlerini kapatır. Çalışma alanı diskte kalır. */
  async reapIdle(at = this.now()): Promise<number> {
    let n = 0;
    for (const s of this.states.values()) {
      if (s.running && s.busy === 0 && at - s.lastUsed > this.cfg.CODE_IDLE_SECONDS * 1000) {
        await this.release(s);
        n++;
      }
    }
    return n;
  }

  /** Uzun süredir dokunulmayan çalışma alanlarını siler (etkin oturumlar hariç). */
  async sweepWorkspaces(): Promise<number> {
    const ttl = this.cfg.CODE_WORKSPACE_TTL_DAYS * 86_400_000;
    let n = 0;
    for (const id of existsSync(this.root()) ? readdirSync(this.root()) : []) {
      if (this.states.has(id)) continue;
      const touched = join(this.root(), id, '.git', 'sixfinger', 'touched');
      const at = existsSync(touched) ? statSync(touched).mtimeMs : statSync(join(this.root(), id)).mtimeMs;
      if (this.now() - at > ttl) {
        rmSync(join(this.root(), id), { recursive: true, force: true });
        n++;
      }
    }
    return n;
  }

  // ---------- yardımcılar ----------
  private secretFor = (id: string) => createHmac('sha256', this.cfg.SANDBOXD_TOKEN).update(`egress:${id}`).digest('hex').slice(0, 32);

  private proxyUrl(id: string): string {
    return `http://${id}:${this.secretFor(id)}@${this.cfg.CODE_PROXY_HOST}:${this.cfg.CODE_PROXY_PORT}`;
  }

  private profileFor(id: string, dir: string, req: Omit<PrepareRequest, 'token'>): CodeProfile {
    const withProxy = Boolean(this.egress) && req.network.mode !== 'none';
    return {
      kind: 'code',
      dir,
      hostDir: join(this.cfg.codeHostDir, 'workspaces', id),
      memMb: this.cfg.CODE_MEM_MB,
      cpus: this.cfg.CODE_CPUS,
      pids: this.cfg.CODE_PIDS,
      tmpMb: this.cfg.CODE_TMP_MB,
      fsizeBytes: Math.max(req.diskMb, 64) * 1024 * 1024,
      network: withProxy ? 'proxy' : 'none',
      networkName: withProxy ? this.cfg.CODE_NETWORK_NAME : undefined,
      proxyUrl: withProxy ? this.proxyUrl(id) : undefined,
      env: req.env,
    };
  }

  private state(user: string, session: string): State {
    const s = this.states.get(codeSessionId(session));
    if (!s || s.user !== user) throw new SandboxError('Çalışma alanı hazır değil; önce prepare çağrılmalı.', 'not_prepared');
    s.lastUsed = this.now();
    return s;
  }

  /** Aynı oturumun işlemlerini sıraya sokar. */
  private serial<T>(s: State, fn: () => Promise<T>): Promise<T> {
    const run = s.chain.catch(() => {}).then(async () => {
      s.busy++;
      try {
        return await fn();
      } finally {
        s.busy--;
        s.lastUsed = this.now();
      }
    });
    s.chain = run.catch(() => {});
    return run;
  }

  private async release(s: State): Promise<void> {
    if (!s.running) return;
    s.running = false;
    await this.runtime.release(s.id, { snapshot: false }).catch((err) => this.log.warn({ err, id: s.id }, 'Code sandbox kapatılamadı'));
  }

  /** Konteyner çalışır hale gelir; havuz doluysa en uzun süredir boşta olan kapatılır, hepsi meşgulse kısa süre beklenir. */
  private async ensureRunning(s: State): Promise<void> {
    if (s.running) return;
    const deadline = this.now() + 20_000;
    for (;;) {
      const running = [...this.states.values()].filter((x) => x.running);
      if (running.length < this.cfg.CODE_MAX_CONTAINERS) break;
      const victim = running.filter((x) => x.busy === 0 && x !== s).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (victim) {
        await this.release(victim);
        break;
      }
      if (this.now() > deadline) throw new SandboxBusyError('Tüm Code sandbox\'ları şu an kullanımda. Biraz sonra tekrar dene.', 15);
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.runtime.ensure(s.id, s.profile);
    s.running = true;
  }

  private container(s: State, argv: string[], timeoutSeconds: number, maxOutput = this.cfg.OUTPUT_MAX_BYTES, stdin?: Buffer): Promise<ExecResult> {
    return this.runtime.exec(s.id, { argv, timeoutMs: timeoutSeconds * 1000, maxOutput, stdin });
  }

  private async measureDisk(s: State, force = false): Promise<number> {
    if (!force && s.measureMs > 1_000 && this.now() - s.diskAt < 10_000) return s.diskUsedMb;
    s.diskAt = this.now();
    const r = await capture('du', ['-sk', s.dir], { timeoutMs: 90_000, maxOutput: 4096 });
    s.measureMs = r.durationMs;
    const kb = Number(r.stdout.split(/\s+/)[0]);
    if (Number.isFinite(kb)) s.diskUsedMb = Math.ceil(kb / 1024);
    return s.diskUsedMb;
  }

  // ---------- hazırlık ----------
  /** Çalışma alanını hazırlar: gerekirse klonlar, dal açar, konteyneri başlatır, kurulum betiğini bir kez çalıştırır. */
  async prepare(req: PrepareRequest): Promise<PrepareResult> {
    if (!REPO_RE.test(req.repo) || req.repo.split('/').some((p) => p === '.' || p === '..')) throw new SandboxError('Geçersiz repo adı.');
    if (!BRANCH_RE.test(req.baseBranch) || !BRANCH_RE.test(req.workBranch)) throw new SandboxError('Geçersiz branch adı.');
    if (req.cloneUrl && this.cfg.SANDBOX_RUNTIME !== 'local-unsafe') throw new SandboxError('cloneUrl yalnızca testlerde kullanılabilir.');
    const id = codeSessionId(req.session);
    const dir = join(this.root(), id);
    const { token, ...rest } = req;

    let s = this.states.get(id);
    if (s && s.user !== req.user) throw new SandboxError('Bu çalışma alanı başka bir kullanıcıya ait.');
    const profile = this.profileFor(id, dir, rest);
    const envHash = shortHash({ env: req.env, net: profile.network, mem: profile.memMb, fsize: profile.fsizeBytes });
    if (!s) {
      s = { id, user: req.user, dir, profile, req: rest, envHash, running: false, lastUsed: this.now(), busy: 0, diskUsedMb: 0, diskAt: 0, measureMs: 0, chain: Promise.resolve() };
      this.states.set(id, s);
    }
    const st = s;

    return this.serial(st, async () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // Ortam değişkenleri/ağ/disk değiştiyse konteyner yeniden oluşturulur (çalışma alanı korunur).
      if (st.envHash !== envHash) await this.release(st);
      st.profile = profile;
      st.req = rest;
      st.envHash = envHash;
      this.egress?.register(id, this.secretFor(id), req.network);

      // 1) klonlama (token yalnızca burada, tek seferlik yardımcıda)
      let cloned = false;
      if (!existsSync(join(dir, '.git'))) {
        if (!token && !req.cloneUrl) throw new SandboxError('Çalışma alanı henüz klonlanmadı ve GitHub erişimi verilmedi.', 'not_prepared');
        for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
        const url = req.cloneUrl ?? `https://github.com/${req.repo}.git`;
        const gitId = `${id}-git`;
        this.egress?.register(gitId, this.secretFor(gitId), { mode: 'custom', domains: ['github.com'] });
        const helperProfile: CodeProfile = { ...profile, network: this.egress ? 'proxy' : 'none', networkName: this.egress ? this.cfg.CODE_NETWORK_NAME : undefined, proxyUrl: this.egress ? this.proxyUrl(gitId) : undefined, env: {} };
        const askpass = 'credential.helper=!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f';
        const r = await this.runtime.helper({
          argv: ['git', '-c', 'credential.helper=', '-c', askpass, ...(req.cloneUrl ? ['-c', 'protocol.file.allow=always'] : []), 'clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', req.baseBranch, url, '.'],
          profile: helperProfile,
          secretEnv: token ? { GH_TOKEN: token } : undefined,
          timeoutMs: this.cfg.CODE_CLONE_TIMEOUT_SECONDS * 1000,
          maxOutput: 32 * 1024,
        });
        this.egress?.unregister(gitId);
        if (r.exitCode !== 0) {
          const why = (r.stderr || r.stdout).replace(/x-access-token:[^@\s]+@/g, '').trim().slice(-400);
          rmSync(join(dir, '.git'), { recursive: true, force: true });
          throw new SandboxError(`Repo klonlanamadı: ${r.timedOut ? 'zaman aşımı' : why || 'bilinmeyen hata'}`);
        }
        cloned = true;
      }

      // 2) konteyner + ilk kurulum (dal, kimlik)
      await this.ensureRunning(st);
      if (!existsSync(join(dir, '.git', 'sixfinger', 'init'))) {
        const author = req.author ?? { name: 'SixFinger Code', email: 'noreply@sixfinger.live' };
        const r = await this.container(st, ['sh', '-c', GIT_INIT_SCRIPT, 'sh', req.workBranch, author.name, author.email], 60);
        if (r.exitCode !== 0) throw new SandboxError(`Dal hazırlanamadı: ${(r.stderr || r.stdout).trim().slice(-300)}`, 'internal');
      }

      // 3) kurulum betiği (içeriği değişmedikçe bir kez)
      let setupRan = false;
      let setupOk: boolean | null = null;
      let setupOutput = '';
      const script = req.setupScript.trim();
      const marker = join(dir, '.git', 'sixfinger', 'setup');
      const want = script ? shortHash(script) : '';
      const have = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
      if (script && want !== have) {
        setupRan = true;
        const r = await this.container(st, ['bash', '-lc', script], this.cfg.CODE_SETUP_TIMEOUT_SECONDS, 16 * 1024);
        setupOk = r.exitCode === 0 && !r.timedOut;
        setupOutput = [r.stdout, r.stderr].filter(Boolean).join('\n').slice(-4_000);
        if (setupOk) writeFileSync(marker, want);
      }

      try {
        utimesSync(join(dir, '.git', 'sixfinger'), new Date(), new Date());
        writeFileSync(join(dir, '.git', 'sixfinger', 'touched'), String(this.now()));
      } catch {
        /* en iyi çaba */
      }
      const base = await this.container(st, ['sh', '-c', 'cat .git/sixfinger/base; git rev-parse --abbrev-ref HEAD'], 20, 4096);
      const [baseSha = '', branch = req.workBranch] = base.stdout.trim().split('\n');
      return { cloned, setupRan, setupOk, setupOutput, baseSha, branch, diskUsedMb: await this.measureDisk(st, true), diskMb: req.diskMb };
    });
  }

  // ---------- işlemler ----------
  async exec(user: string, session: string, command: string, timeoutSeconds?: number): Promise<ExecResult & { diskUsedMb: number }> {
    const s = this.state(user, session);
    const seconds = Math.min(Math.max(1, Math.floor(timeoutSeconds ?? this.cfg.CODE_EXEC_DEFAULT_SECONDS)), this.cfg.CODE_EXEC_MAX_SECONDS);
    return this.serial(s, async () => {
      if (s.diskUsedMb > s.req.diskMb * 1.25 && !CLEANUP_CMD.test(command)) {
        throw new SandboxError(`Disk doldu (${s.diskUsedMb} / ${s.req.diskMb} MB). Önce gereksiz dosyaları sil (ör. node_modules, derleme çıktıları, önbellekler); ya da ortamın diskini artır.`, 'disk_full');
      }
      await this.ensureRunning(s);
      const r = await this.runtime.exec(s.id, { argv: ['bash', '-lc', command], timeoutMs: seconds * 1000, maxOutput: this.cfg.OUTPUT_MAX_BYTES });
      return { ...r, diskUsedMb: await this.measureDisk(s) };
    });
  }

  async readFile(user: string, session: string, path: string): Promise<{ content: string; truncated: boolean }> {
    const rel = workPath(path);
    const s = this.state(user, session);
    const limit = this.cfg.CODE_FILE_MAX_BYTES;
    return this.serial(s, async () => {
      await this.ensureRunning(s);
      const r = await this.container(
        s,
        ['sh', '-c', 'if [ ! -e "$1" ]; then exit 44; fi; if [ -d "$1" ]; then exit 45; fi; head -c "$2" -- "$1"', 'sh', rel, String(limit + 1)],
        20,
        limit + 8,
      );
      if (r.exitCode === 44) throw new SandboxError(`Dosya bulunamadı: ${path}`, 'not_found');
      if (r.exitCode === 45) throw new SandboxError(`Bu bir klasör, dosya değil: ${path}`);
      if (r.exitCode !== 0) throw new SandboxError(`Dosya okunamadı: ${r.stderr.trim().slice(0, 200)}`);
      if (r.stdout.includes('\u0000')) throw new SandboxError('Bu dosya ikili (binary) görünüyor; okunamaz.');
      const truncated = Buffer.byteLength(r.stdout) > limit;
      return { content: truncated ? Buffer.from(r.stdout).subarray(0, limit).toString('utf8') : r.stdout, truncated };
    });
  }

  async writeFile(user: string, session: string, path: string, content: string): Promise<{ bytes: number; diskUsedMb: number }> {
    const rel = workPath(path);
    if (rel === '.git' || rel.startsWith('.git/')) throw new SandboxError('.git klasörüne yazılamaz (git işlemleri sunucu tarafından yapılır).');
    const data = Buffer.from(content, 'utf8');
    if (data.length > this.cfg.CODE_FILE_MAX_BYTES) throw new SandboxError(`Dosya çok büyük (en fazla ${this.cfg.CODE_FILE_MAX_BYTES} bayt). Daha küçük parçalara böl.`, 'too_large');
    const s = this.state(user, session);
    return this.serial(s, async () => {
      if (s.diskUsedMb + data.length / 1_048_576 > s.req.diskMb) {
        throw new SandboxError(`Disk doldu (${s.diskUsedMb} / ${s.req.diskMb} MB). Önce gereksiz dosyaları sil ya da ortamın diskini artır.`, 'disk_full');
      }
      await this.ensureRunning(s);
      const r = await this.container(s, ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', rel], 30, 4096, data);
      if (r.exitCode !== 0) throw new SandboxError(`Dosya yazılamadı: ${(r.stderr || r.stdout).trim().slice(0, 200) || 'bilinmeyen hata'}`);
      return { bytes: data.length, diskUsedMb: await this.measureDisk(s) };
    });
  }

  /**
   * Dosya adı kalıbıyla arar. ripgrep yalnızca dosyaları listeler (.gitignore'a uyar, .git hariç); kalıp burada süzülür:
   * `rg --glob` ile verilen kalıp ignore kurallarını ezip gizli/derleme dosyalarını da getirirdi.
   */
  async glob(user: string, session: string, pattern: string, path?: string, limit = 100): Promise<{ files: string[]; truncated: boolean }> {
    if (!pattern || pattern.length > 300 || pattern.includes('\0')) throw new SandboxError('Geçersiz glob kalıbı.');
    const base = path ? workPath(path) : '.';
    const re = globToRegExp(pattern);
    const s = this.state(user, session);
    return this.serial(s, async () => {
      await this.ensureRunning(s);
      const r = await this.container(s, ['rg', '--files', '--hidden', '--glob', '!.git', '--sort', 'path', '--', base], 30, 4 * 1024 * 1024);
      if (r.exitCode === 127) throw new SandboxError('ripgrep (rg) sandbox imajında yok.', 'internal');
      const all = r.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, '')).filter((f) => re.test(base === '.' ? f : f.slice(base.length + 1)));
      return { files: all.slice(0, limit), truncated: all.length > limit || r.truncated };
    });
  }

  async grep(
    user: string,
    session: string,
    a: { pattern: string; path?: string; include?: string; literal?: boolean; caseSensitive?: boolean; limit?: number },
  ): Promise<{ lines: string[]; truncated: boolean }> {
    if (!a.pattern || a.pattern.length > 500 || a.pattern.includes('\0')) throw new SandboxError('Geçersiz arama kalıbı.');
    if (a.include && (a.include.length > 200 || a.include.includes('\0'))) throw new SandboxError('Geçersiz include kalıbı.');
    const base = a.path ? workPath(a.path) : '.';
    const limit = a.limit ?? 100;
    const s = this.state(user, session);
    return this.serial(s, async () => {
      await this.ensureRunning(s);
      // `--glob` kalıpları ignore kurallarını ezer; sonradan gelen dışlamalar önceliklidir, bu yüzden dışlamalar include'dan SONRA verilir.
      const argv = ['rg', '--line-number', '--no-heading', '--color', 'never', '--hidden', '--max-columns', '300', '--max-columns-preview', ...(a.literal ? ['--fixed-strings'] : []), ...(a.caseSensitive ? [] : ['--smart-case']), ...(a.include ? ['--glob', a.include] : []), '--glob', '!.git', '--glob', '!node_modules', '--glob', '!.venv', '--glob', '!__pycache__', '-e', a.pattern, '--', base];
      const r = await this.container(s, argv, 30, 512 * 1024);
      if (r.exitCode === 127) throw new SandboxError('ripgrep (rg) sandbox imajında yok.', 'internal');
      if (r.exitCode === 2 && !r.stdout) throw new SandboxError(`Arama kalıbı geçersiz: ${r.stderr.trim().slice(0, 200)}`);
      const all = r.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, ''));
      return { lines: all.slice(0, limit), truncated: all.length > limit || r.truncated };
    });
  }

  /** Çalışma alanının başlangıç commit'ine göre değişiklikleri (+N −M) hesaplar. Her şeyi sahneler (commit etmez). */
  async changes(user: string, session: string): Promise<Changes> {
    const s = this.state(user, session);
    return this.serial(s, async () => {
      await this.ensureRunning(s);
      const script = 'git add -A -- . >/dev/null 2>&1; base=$(cat .git/sixfinger/base); echo "BASE $base"; git diff --cached --numstat "$base"; echo "---"; git diff --cached --name-status "$base"';
      const r = await this.container(s, ['sh', '-c', script], 60, 512 * 1024);
      if (r.exitCode !== 0) throw new SandboxError(`Değişiklikler okunamadı: ${r.stderr.trim().slice(0, 200)}`);
      const [head = '', ...rest] = r.stdout.split('\n');
      const baseSha = head.replace('BASE ', '').trim();
      const cut = rest.indexOf('---');
      const num = new Map<string, { a: number; d: number }>();
      for (const l of rest.slice(0, cut < 0 ? rest.length : cut)) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
        if (m) num.set(m[3]!, { a: m[1] === '-' ? 0 : Number(m[1]), d: m[2] === '-' ? 0 : Number(m[2]) });
      }
      const files: ChangedFile[] = [];
      for (const l of cut < 0 ? [] : rest.slice(cut + 1)) {
        const m = /^([AMDR])\d*\t(?:.+\t)?(.+)$/.exec(l);
        if (!m) continue;
        const n = num.get(m[2]!) ?? { a: 0, d: 0 };
        files.push({ path: m[2]!, status: m[1] === 'A' ? 'added' : m[1] === 'D' ? 'deleted' : m[1] === 'R' ? 'renamed' : 'modified', additions: n.a, deletions: n.d });
      }
      return { files, additions: files.reduce((x, f) => x + f.additions, 0), deletions: files.reduce((x, f) => x + f.deletions, 0), baseSha };
    });
  }

  /** Çalışma alanındaki her şeyi tek bir commit'e alır. Değişiklik yoksa `sha: null`. */
  async commit(user: string, session: string, message: string): Promise<{ sha: string | null }> {
    const msg = message.replace(/\0/g, '').trim().slice(0, 2_000) || 'SixFinger Code değişiklikleri';
    const s = this.state(user, session);
    return this.serial(s, async () => {
      await this.ensureRunning(s);
      const script = 'git add -A -- . >/dev/null 2>&1; if git diff --cached --quiet; then echo NONE; else git -c core.hooksPath=/dev/null commit -q --no-verify -m "$1" >/dev/null && git rev-parse HEAD; fi';
      const r = await this.container(s, ['sh', '-c', script, 'sh', msg], 60, 8192);
      if (r.exitCode !== 0) throw new SandboxError(`Commit atılamadı: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
      const out = r.stdout.trim();
      return { sha: out === 'NONE' || !out ? null : out.split('\n').at(-1)! };
    });
  }

  async usage(user: string, session: string): Promise<{ diskUsedMb: number; diskMb: number; running: boolean }> {
    const s = this.state(user, session);
    return { diskUsedMb: await this.measureDisk(s, true), diskMb: s.req.diskMb, running: s.running };
  }

  async destroy(user: string, session: string): Promise<void> {
    const id = codeSessionId(session);
    const s = this.states.get(id);
    if (s && s.user !== user) throw new SandboxError('Bu çalışma alanı başka bir kullanıcıya ait.');
    this.states.delete(id);
    this.egress?.unregister(id);
    await this.runtime.destroy(id).catch(() => {});
    rmSync(join(this.root(), id), { recursive: true, force: true });
  }
}
