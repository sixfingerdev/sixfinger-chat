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

/** Code çalışma alanı sandbox'ı: kalıcı diskte, daha büyük kaynaklı, proxy üzerinden filtreli internetli. */
export interface CodeProfile {
  kind: 'code';
  /** Çalışma alanının sandboxd içinden görünen yolu. */
  dir: string;
  /** Aynı dizinin ana makinedeki yolu (docker bind kaynağı). */
  hostDir: string;
  memMb: number;
  cpus: number;
  pids: number;
  tmpMb: number;
  /** Tek dosyanın üst boyutu (bayt). */
  fsizeBytes: number;
  /** `none`: ağ yok. `proxy`: yalnızca iç ağdaki çıkış proxy'si. */
  network: 'none' | 'proxy';
  /** `proxy` için: iç ağın adı ve proxy adresi (kimlik bilgisiyle). */
  networkName?: string;
  proxyUrl?: string;
  /** Konteynere verilecek ortam değişkenleri (kullanıcının ortamından). Değerler komut satırına yazılmaz. */
  env: Record<string, string>;
}

/** Tek seferlik yardımcı konteyner (ör. token gerektiren `git clone`): çalışma alanı bağlanır, iş bitince silinir. */
export interface HelperOptions {
  argv: string[];
  profile: CodeProfile;
  /** Yalnızca bu sürecin ortamına verilir (komut satırında ve `docker inspect`'te görünmez). */
  secretEnv?: Record<string, string>;
  /** Çalışma alanını salt okunur bağla (ajanın yazdığı dosyalar token'lı konteynerde değiştirilemesin). */
  readOnly?: boolean;
  timeoutMs: number;
  maxOutput: number;
}

export interface Runtime {
  readonly name: string;
  /** Oturum için sandbox'ı hazırlar: yoksa oluşturur, varsa anlık görüntüden geri yükler. */
  ensure(id: string, profile?: CodeProfile): Promise<void>;
  exec(id: string, opts: ExecOptions): Promise<ExecResult>;
  /** Sandbox'ı kapatır; `snapshot` ise /work içeriğini diske kaydeder. */
  release(id: string, opts: { snapshot: boolean }): Promise<void>;
  /** Sandbox'ı ve anlık görüntüsünü siler. */
  destroy(id: string): Promise<void>;
  /** Çalışan sandbox kimlikleri (başlangıçta öksüzleri temizlemek için). */
  list(): Promise<string[]>;
  /** Çalışan Code sandbox kimlikleri (başlangıçta öksüzleri kapatmak için). */
  listCode(): Promise<string[]>;
  /** Token gerektiren tek seferlik işler için (yalnızca Code). */
  helper(opts: HelperOptions): Promise<ExecResult>;
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
    readonly code: 'bad_request' | 'not_found' | 'too_large' | 'internal' | 'not_prepared' | 'disk_full' | 'is_directory' = 'bad_request',
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
