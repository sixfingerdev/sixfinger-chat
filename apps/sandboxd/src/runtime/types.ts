export interface ExecOptions {
  /** Sandbox içinde çalışacak komut ve argümanları (kabuk YOK; gerekirse ['bash','-lc',...] verilir). */
  argv: string[];
  stdin?: Buffer;
  timeoutMs: number;
  /** stdout ve stderr için ayrı ayrı üst sınır (bayt). */
  maxOutput: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Çıktı sınırı aşıldığı için kesildi. */
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

export interface Runtime {
  readonly name: string;
  /** Oturum için sandbox'ı hazırlar: yoksa oluşturur, varsa anlık görüntüden geri yükler. */
  ensure(id: string): Promise<void>;
  exec(id: string, opts: ExecOptions): Promise<ExecResult>;
  /** Sandbox'ı kapatır; `snapshot` ise /work içeriğini diske kaydeder. */
  release(id: string, opts: { snapshot: boolean }): Promise<void>;
  /** Sandbox'ı ve anlık görüntüsünü siler. */
  destroy(id: string): Promise<void>;
  /** Çalışan sandbox kimlikleri (başlangıçta öksüzleri temizlemek için). */
  list(): Promise<string[]>;
  health(): Promise<{ ok: boolean; details: Record<string, unknown> }>;
}

export class SandboxBusyError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds = 5,
  ) {
    super(message);
    this.name = 'SandboxBusyError';
  }
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_request' | 'not_found' | 'too_large' | 'internal' = 'bad_request',
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
