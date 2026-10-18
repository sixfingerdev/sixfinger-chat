import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Config } from './config.ts';
import { SandboxBusyError, SandboxError, type ExecResult, type Runtime } from './runtime/types.ts';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

interface Session {
  id: string;
  user: string;
  lastUsed: number;
  /** Şu an çalışan işlem sayısı (boşta kapatmayı engeller). */
  busy: number;
  ready: Promise<void>;
}

/** Oturum adından, konteyner adında güvenle kullanılabilecek sabit uzunlukta bir kimlik üretir. */
export const sessionId = (raw: string): string => `s${createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;

/**
 * Kullanıcının verdiği yolu /work'e göre GÖRECELİ ve güvenli hale getirir.
 * Mutlak yollar yalnızca /work altındaysa kabul edilir; `..` ile dışarı çıkılamaz.
 * (Asıl koruma konteynerin kendisidir; bu, yanlış kullanımı erken yakalar.)
 */
export function workPath(input: string): string {
  let p = input.trim();
  if (!p) throw new SandboxError('Dosya yolu boş.');
  if (p.length > 400 || p.includes('\0')) throw new SandboxError('Geçersiz dosya yolu.');
  if (p === '/work') p = '.';
  else if (p.startsWith('/work/')) p = p.slice('/work/'.length);
  else if (p.startsWith('/')) throw new SandboxError('Dosyalar /work klasöründe olmalı (ör. "app.py" ya da "/work/app.py").');
  p = posix.normalize(p);
  if (p === '..' || p.startsWith('../')) throw new SandboxError('Yol /work dışına çıkamaz.');
  if (p === '.' ) return '.';
  p = p.replace(/^\.\//, '');
  return p.startsWith('-') ? `./${p}` : p;
}

export interface FileRead {
  content: string;
  /** Dosya boyut sınırını aştığı için kesildi. */
  truncated: boolean;
}

export class SandboxService {
  private sessions = new Map<string, Session>();
  private userChains = new Map<string, Promise<unknown>>();
  private execActive = 0;
  private waiters: Array<{ grant: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private reaper?: NodeJS.Timeout;

  constructor(
    private readonly cfg: Config,
    readonly runtime: Runtime,
    private readonly log: Log,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------- yaşam döngüsü ----------
  async start(): Promise<void> {
    // Önceki çalışmadan kalan öksüz sandbox'ları kapat (içerikleri anlık görüntüye alınır).
    for (const id of await this.runtime.list().catch(() => [] as string[])) {
      await this.runtime.release(id, { snapshot: true }).catch(() => {});
    }
    this.reaper = setInterval(() => void this.reapIdle().catch((err) => this.log.error({ err }, 'boşta temizleme hatası')), 30_000);
    this.reaper.unref();
  }

  async stop(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all([...this.sessions.values()].map((s) => this.runtime.release(s.id, { snapshot: true }).catch(() => {})));
    this.sessions.clear();
  }

  stats() {
    return {
      runtime: this.runtime.name,
      containers: this.sessions.size,
      maxContainers: this.cfg.MAX_CONTAINERS,
      execActive: this.execActive,
      maxConcurrentExec: this.cfg.MAX_CONCURRENT_EXEC,
      queued: this.waiters.length,
      maxQueue: this.cfg.MAX_QUEUE,
    };
  }

  /** Boşta kalan sandbox'ları kapatır (çalışma alanı anlık görüntüye alınır). */
  async reapIdle(at = this.now()): Promise<number> {
    let n = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.busy === 0 && at - s.lastUsed > this.cfg.IDLE_SECONDS * 1000) {
        this.sessions.delete(s.id);
        await this.runtime.release(s.id, { snapshot: true }).catch((err) => this.log.warn({ err, id: s.id }, 'kapatılamadı'));
        n++;
      }
    }
    return n;
  }

  // ---------- kabul kontrolü ----------
  private acquireSlot(): Promise<() => void> {
    const release = () => {
      this.execActive--;
      const next = this.waiters.shift();
      if (next) {
        clearTimeout(next.timer);
        this.execActive++;
        next.grant();
      }
    };
    if (this.execActive < this.cfg.MAX_CONCURRENT_EXEC) {
      this.execActive++;
      return Promise.resolve(release);
    }
    if (this.waiters.length >= this.cfg.MAX_QUEUE) {
      return Promise.reject(new SandboxBusyError('Sandbox şu an çok yoğun. Birkaç saniye sonra tekrar dene.', 8));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => resolve(release),
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== entry);
          reject(new SandboxBusyError('Sandbox sırası çok uzun sürdü. Tekrar dene.', 10));
        }, 25_000),
      };
      this.waiters.push(entry);
    });
  }

  /** Aynı kullanıcının işlemleri sıraya girer: tek kullanıcı havuzu tek başına dolduramaz. */
  private withUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.userChains.get(user) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    this.userChains.set(user, tail);
    void tail.then(() => {
      if (this.userChains.get(user) === tail) this.userChains.delete(user);
    });
    return run;
  }

  private async getSession(user: string, raw: string): Promise<Session> {
    const id = sessionId(raw);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastUsed = this.now();
      return existing;
    }
    if (this.sessions.size >= this.cfg.MAX_CONTAINERS) {
      // En uzun süredir boşta duranı kapatıp yer aç.
      const victim = [...this.sessions.values()].filter((s) => s.busy === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!victim) throw new SandboxBusyError('Tüm sandbox\'lar şu an kullanımda. Birkaç saniye sonra tekrar dene.', 10);
      this.sessions.delete(victim.id);
      await this.runtime.release(victim.id, { snapshot: true }).catch(() => {});
    }
    const s: Session = { id, user, lastUsed: this.now(), busy: 0, ready: Promise.resolve() };
    s.ready = this.runtime.ensure(id);
    this.sessions.set(id, s);
    try {
      await s.ready;
    } catch (err) {
      this.sessions.delete(id);
      throw err;
    }
    return s;
  }

  private run<T>(user: string, raw: string, fn: (id: string) => Promise<T>): Promise<T> {
    return this.withUser(user, async () => {
      const release = await this.acquireSlot();
      let s: Session | undefined;
      try {
        s = await this.getSession(user, raw);
        s.busy++;
        return await fn(s.id);
      } finally {
        if (s) {
          s.busy--;
          s.lastUsed = this.now();
        }
        release();
      }
    });
  }

  // ---------- işlemler ----------
  exec(user: string, session: string, command: string, timeoutSeconds?: number): Promise<ExecResult> {
    const seconds = Math.min(Math.max(1, Math.floor(timeoutSeconds ?? this.cfg.EXEC_DEFAULT_SECONDS)), this.cfg.EXEC_MAX_SECONDS);
    return this.run(user, session, (id) =>
      this.runtime.exec(id, { argv: ['bash', '-lc', command], timeoutMs: seconds * 1000, maxOutput: this.cfg.OUTPUT_MAX_BYTES }),
    );
  }

  async writeFile(user: string, session: string, path: string, content: string): Promise<{ bytes: number }> {
    const rel = workPath(path);
    const data = Buffer.from(content, 'utf8');
    if (data.length > this.cfg.FILE_MAX_BYTES) throw new SandboxError(`Dosya çok büyük (en fazla ${this.cfg.FILE_MAX_BYTES} bayt).`, 'too_large');
    const r = await this.run(user, session, (id) =>
      this.runtime.exec(id, {
        argv: ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', rel],
        stdin: data,
        timeoutMs: 20_000,
        maxOutput: 4096,
      }),
    );
    if (r.exitCode !== 0) throw new SandboxError(`Dosya yazılamadı: ${(r.stderr || r.stdout).trim().slice(0, 200) || 'bilinmeyen hata'}`);
    return { bytes: data.length };
  }

  async readFile(user: string, session: string, path: string): Promise<FileRead> {
    const rel = workPath(path);
    const limit = this.cfg.FILE_MAX_BYTES;
    const r = await this.run(user, session, (id) =>
      this.runtime.exec(id, {
        argv: [
          'sh',
          '-c',
          'if [ ! -e "$1" ]; then exit 44; fi; if [ -d "$1" ]; then exit 45; fi; head -c "$2" -- "$1"',
          'sh',
          rel,
          String(limit + 1),
        ],
        timeoutMs: 20_000,
        maxOutput: limit + 8,
      }),
    );
    if (r.exitCode === 44) throw new SandboxError(`Dosya bulunamadı: ${path}`, 'not_found');
    if (r.exitCode === 45) throw new SandboxError(`Bu bir klasör, dosya değil: ${path}`);
    if (r.exitCode !== 0) throw new SandboxError(`Dosya okunamadı: ${r.stderr.trim().slice(0, 200)}`);
    if (r.stdout.includes('\u0000')) throw new SandboxError('Bu dosya ikili (binary) görünüyor; okunamaz.');
    const truncated = Buffer.byteLength(r.stdout) > limit;
    return { content: truncated ? Buffer.from(r.stdout).subarray(0, limit).toString('utf8') : r.stdout, truncated };
  }

  async editFile(
    user: string,
    session: string,
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<{ replacements: number; snippet: string }> {
    if (!oldString) throw new SandboxError('old_string boş olamaz. Yeni dosya için write aracını kullan.');
    if (oldString === newString) throw new SandboxError('old_string ve new_string aynı; değişiklik yok.');
    const file = await this.readFile(user, session, path);
    if (file.truncated) throw new SandboxError('Dosya düzenlemek için çok büyük.', 'too_large');
    const parts = file.content.split(oldString);
    const count = parts.length - 1;
    if (count === 0) {
      throw new SandboxError('old_string dosyada bulunamadı. Boşluk/girinti dahil birebir eşleşmeli; önce read ile dosyayı oku.', 'not_found');
    }
    if (count > 1 && !replaceAll) {
      throw new SandboxError(`old_string dosyada ${count} kez geçiyor. Benzersiz olması için çevresindeki satırları da ekle ya da replace_all kullan.`);
    }
    const updated = replaceAll ? parts.join(newString) : parts[0] + newString + parts.slice(1).join(oldString);
    await this.writeFile(user, session, path, updated);
    // Değişen yerin çevresinden kısa bir kesit döndür.
    const at = updated.indexOf(newString);
    const lines = updated.split('\n');
    const line = updated.slice(0, Math.max(0, at)).split('\n').length - 1;
    const from = Math.max(0, line - 2);
    const snippet = lines.slice(from, from + 8).map((l, i) => `${from + i + 1}\t${l}`).join('\n');
    return { replacements: replaceAll ? count : 1, snippet };
  }

  async listFiles(user: string, session: string): Promise<Array<{ path: string; bytes: number }>> {
    const r = await this.run(user, session, (id) =>
      this.runtime.exec(id, {
        argv: ['sh', '-c', "find . -maxdepth 4 -type f -not -path './.*' -printf '%P\\t%s\\n' | head -n 300"],
        timeoutMs: 15_000,
        maxOutput: 64 * 1024,
      }),
    );
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [path, size] = l.split('\t');
        return { path: path!, bytes: Number(size) || 0 };
      });
  }

  async destroy(user: string, session: string): Promise<void> {
    const id = sessionId(session);
    this.sessions.delete(id);
    await this.runtime.destroy(id);
    void user;
  }
}
