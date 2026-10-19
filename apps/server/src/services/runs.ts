import type { MessageDTO, StreamEvent } from '@sixfinger/shared';

/** Bir yanıtı dinleyen bağlantı (SSE). */
export interface Subscriber {
  send(event: StreamEvent): void;
  close(): void;
}

/**
 * Sunucuda çalışan bir yanıt üretimi. İstemci bağlantısından bağımsızdır: uygulama kapansa bile üretim sürer,
 * sonuç veritabanına yazılır. İstemci geri gelince `subscribe` ile o ana kadarki durumu (snapshot) ve devamını alır.
 */
export class Run {
  readonly ac = new AbortController();
  private subs = new Set<Subscriber>();
  /** O ana kadar üretilen mesajın anlık görüntüsü; üretim döngüsü tarafından atanır. */
  snapshot: (() => MessageDTO) | null = null;
  finished = false;
  readonly startedAt = Date.now();
  /** Son evre olayı: geri bağlanan istemciye anlık görüntüyle birlikte yeniden gönderilir. */
  private lastPhase: Extract<StreamEvent, { type: 'phase' }> | null = null;
  /** Yanıt tamamlanıp kaydedildi (`done` gönderildi); geriye yalnızca başlık/hafıza gibi yan işler kaldı. Yeni mesaj artık beklemez. */
  settled = false;

  constructor(
    readonly chatId: string,
    readonly userId: string,
    readonly assistantId: string,
  ) {}

  get signal(): AbortSignal {
    return this.ac.signal;
  }

  emit(event: StreamEvent): void {
    if (event.type === 'phase') {
      this.lastPhase = event;
      event = { ...event, elapsedMs: Date.now() - this.startedAt };
    }
    for (const s of this.subs) s.send(event);
  }

  /** Dinleyici ekler. `withSnapshot` ise önce mevcut durum gönderilir (geri gelen istemci için). Döner: ayrılma işlevi. */
  subscribe(sub: Subscriber, withSnapshot: boolean): () => void {
    if (withSnapshot && this.snapshot) {
      sub.send({ type: 'snapshot', assistantMessage: this.snapshot() });
      if (this.lastPhase) sub.send({ ...this.lastPhase, elapsedMs: Date.now() - this.startedAt });
    }
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Kullanıcı durdurdu. (Bağlantının kapanması durdurma değildir.) */
  stop(): void {
    this.ac.abort();
  }

  /** `done` sonrası: sohbet yeni bir yanıta açılır; başlık gibi yan işler arka planda sürer. */
  settle(): void {
    this.settled = true;
  }

  finish(): void {
    this.finished = true;
    for (const s of this.subs) s.close();
    this.subs.clear();
  }
}

export interface RunHub {
  start(chatId: string, userId: string, assistantId: string): Run;
  forChat(chatId: string): Run | undefined;
  countForUser(userId: string): number;
  activeIds(chatId: string): string[];
  /** Şu an üretimi süren sohbetler. */
  activeChatIds(): string[];
  remove(run: Run): void;
}

export function createRunHub(): RunHub {
  const runs = new Map<string, Run>();
  return {
    start(chatId, userId, assistantId) {
      const run = new Run(chatId, userId, assistantId);
      runs.set(assistantId, run);
      return run;
    },
    forChat(chatId) {
      for (const r of runs.values()) if (r.chatId === chatId && !r.finished && !r.settled) return r;
      return undefined;
    },
    countForUser(userId) {
      let n = 0;
      for (const r of runs.values()) if (r.userId === userId && !r.finished && !r.settled) n++;
      return n;
    },
    activeIds(chatId) {
      return [...runs.values()].filter((r) => r.chatId === chatId && !r.finished && !r.settled).map((r) => r.assistantId);
    },
    activeChatIds() {
      return [...new Set([...runs.values()].filter((r) => !r.finished && !r.settled).map((r) => r.chatId))];
    },
    remove(run) {
      runs.delete(run.assistantId);
    },
  };
}
