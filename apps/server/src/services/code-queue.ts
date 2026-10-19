import { HttpError } from '../lib/errors.ts';

/**
 * Code çalıştırmalarının kuyruğu. Pi 4'te aynı anda yalnızca birkaç oturum rahat çalışır: fazlası sırada bekler (adil, FIFO).
 * Kullanıcı başına aynı anda en çok 1 çalıştırma: tek kullanıcı havuzu tek başına dolduramaz.
 */
export interface CodeQueueOptions {
  maxRuns: number;
  maxQueue: number;
  perUser?: number;
}

interface Waiter {
  user: string;
  grant: () => void;
  reject: (e: unknown) => void;
  onPosition: (pos: number) => void;
  lastPos: number;
}

export class CodeQueue {
  private running = new Map<string, number>();
  private total = 0;
  private waiters: Waiter[] = [];
  private readonly perUser: number;

  constructor(private readonly opts: CodeQueueOptions) {
    this.perUser = opts.perUser ?? 1;
  }

  get stats() {
    return { running: this.total, queued: this.waiters.length, maxRuns: this.opts.maxRuns };
  }

  private canRun(user: string): boolean {
    return this.total < this.opts.maxRuns && (this.running.get(user) ?? 0) < this.perUser;
  }

  private start(user: string): () => void {
    this.total++;
    this.running.set(user, (this.running.get(user) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const n = (this.running.get(user) ?? 1) - 1;
      if (n <= 0) this.running.delete(user);
      else this.running.set(user, n);
      this.pump();
    };
  }

  /** Sıradaki uygun bekleyenleri başlatır (kullanıcı sınırı yüzünden atlananlar sırada kalır). */
  private pump(): void {
    for (let i = 0; i < this.waiters.length; ) {
      const w = this.waiters[i]!;
      if (this.canRun(w.user)) {
        this.waiters.splice(i, 1);
        w.grant();
      } else i++;
    }
    this.waiters.forEach((w, idx) => {
      if (w.lastPos !== idx + 1) {
        w.lastPos = idx + 1;
        w.onPosition(idx + 1);
      }
    });
  }

  /** Yer açılınca bırakma fonksiyonunu döndürür. Kuyruk doluysa 503; iptalde bekleme bırakılır ve AbortError fırlar. */
  acquire(user: string, signal: AbortSignal, onPosition: (pos: number) => void = () => {}): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    // Bekleyen kalıyorsa ya havuz dolu ya da kullanıcı sınırındadır: havuzda yer + bu kullanıcı uygunsa beklemeden başlar.
    if (this.canRun(user)) return Promise.resolve(this.start(user));
    if (this.waiters.length >= this.opts.maxQueue) {
      return Promise.reject(new HttpError(503, 'upstream_busy', 'Code kuyruğu şu an dolu. Birkaç dakika sonra tekrar dene.'));
    }
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        user,
        lastPos: this.waiters.length + 1,
        onPosition,
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          resolve(this.start(user));
        },
        reject,
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          this.pump();
        }
        reject(new DOMException('aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(w);
      onPosition(w.lastPos);
    });
  }
}
