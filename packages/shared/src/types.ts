import type { Tier, TierLimits } from './limits.ts';

export type Locale = 'tr' | 'en';

export interface UserSettings {
  customName: string;
  about: string;
  instructions: string;
  defaultPersona: string;
  memoryEnabled: boolean;
}

export interface UserDTO {
  id: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
  emailVerified: boolean;
  locale: Locale;
  tier: Tier;
  settings: UserSettings;
  createdAt: string;
}

export interface UsageDTO {
  tier: Tier;
  used: number;
  limit: number;
  resetsAt: string;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  /** Access token ömrü (saniye). */
  expiresIn: number;
}

export interface SessionDTO {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface ChatDTO {
  id: string;
  title: string;
  personaId: string;
  /** `code`: SixFinger Code oturumu (sohbet listesinde görünmez). */
  kind: 'chat' | 'code';
  pinned: boolean;
  archived: boolean;
  leafId: string | null;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  /** Zamanlanmış görevin çalıştırması olarak oluşan sohbette görevin kimliği. */
  taskId?: string | null;
  /** Arama sonuçlarında eşleşen mesajdan kesit. */
  snippet?: string;
}

export interface AttachmentDTO {
  name: string;
  mime: string;
  text: string;
  /** Sandbox'a yüklenmişse çalışma alanındaki yol (içerik mesajda yok; model okur). */
  path?: string;
  bytes?: number;
}

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'stopped';

/** Modelin çağırabildiği araçlar. */
export type ToolName = 'web_search' | 'web_fetch' | 'bash' | 'read' | 'write' | 'edit';

/** Bir araç çağrısının yaşam döngüsü. */
export type ToolStatus = 'running' | 'done' | 'error';

/**
 * Asistan mesajının sıralı parçaları: metin ve araç çağrıları araya girerek akar
 * (ör. metin → web_search → web_fetch → metin).
 */
export type MessagePartDTO =
  | { type: 'text'; text: string }
  /** Modelin bir turdaki düşüncesi. Araç sonucundan sonra yeniden düşünürse yeni bir parça açılır (eskisine eklenmez). */
  | { type: 'reasoning'; text: string; ms: number | null }
  | {
      type: 'tool';
      id: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      /** Modele geri verilen sonucun (kısaltılmış) metni. */
      output?: string;
      /** Kartta gösterilen tek satırlık özet ("5 sonuç", "example.com"). */
      summary?: string;
      /** Zengin gösterim için yapısal veri (dosya +N −M, çıkış kodu, yapılacaklar...). Modele gitmez. */
      meta?: Record<string, unknown>;
      ms?: number;
    };

/** Mesaja eklenmiş görselin başvurusu; baytlar `GET /api/images/:id` ile alınır. */
export interface ImageRefDTO {
  id: string;
  name: string;
  mime: string;
}

export interface MessageDTO {
  id: string;
  chatId: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  status: MessageStatus;
  model: string | null;
  attachments: AttachmentDTO[];
  /** Eklenen görseller (yoksa boş ya da yok). */
  images?: ImageRefDTO[];
  feedback: 1 | -1 | null;
  /** Düşünme süresi (ms) */
  reasoningMs: number | null;
  /** Sıralı parçalar. Eski mesajlarda boştur; o zaman `content` gösterilir. */
  parts: MessagePartDTO[];
  createdAt: string;
}

export interface ChatDetailDTO {
  chat: ChatDTO;
  /** Tüm düğümler (ağaç). İstemci `leafId`'den köke giderek aktif yolu çıkarır. */
  messages: MessageDTO[];
}

export interface MemoryDTO {
  id: string;
  content: string;
  createdAt: string;
}

export interface ConfigDTO {
  tier: Tier;
  limits: TierLimits;
  usage: UsageDTO;
  smtpEnabled: boolean;
  /** Code özelliğinin bu kullanıcı için durumu (menüde Code sekmesi gösterilsin mi?). */
  code: { allowed: boolean };
}

export interface SharedChatDTO {
  slug: string;
  title: string;
  createdAt: string;
  messages: Pick<MessageDTO, 'id' | 'role' | 'content' | 'reasoning' | 'createdAt'>[];
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'tier_restricted'
  | 'email_taken'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'invalid_code'
  | 'upstream_unavailable'
  | 'upstream_busy'
  | 'github_required'
  | 'internal';

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------- Akış (SSE) olayları ----------
export type StreamEvent =
  | { type: 'start'; userMessage: MessageDTO | null; assistantMessage: MessageDTO }
  /** Üretim sürerken (ör. uygulama yeniden açılınca) bağlanan istemciye, o ana kadarki mesaj durumu. */
  | { type: 'snapshot'; assistantMessage: MessageDTO }
  | { type: 'reasoning'; delta: string }
  | { type: 'delta'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; id: string; status: ToolStatus; output: string; summary?: string; meta?: Record<string, unknown>; ms: number }
  /** Code: çalışmanın evresi (sırada, çalışma alanı hazırlanıyor, çalışıyor, commit ediliyor). */
  /** `elapsedMs`: turun sunucuda başlamasından bu yana geçen süre (istemci saatinden bağımsız; geri bağlanan istemci sayacı doğru sürdürür). */
  | { type: 'phase'; phase: 'queued' | 'preparing' | 'working' | 'committing' | 'publishing'; position?: number; elapsedMs?: number }
  /** Code: tur sonunda çalışma alanındaki toplam değişiklik (+N −M). */
  | { type: 'changes'; additions: number; deletions: number; files: number; sha: string | null }
  /** Code: modele giden bağlamın tahmini doluluğu (başlıktaki halka). */
  | { type: 'context'; tokens: number; limit: number }
  | { type: 'title'; title: string }
  | { type: 'memory'; memory: MemoryDTO }
  | { type: 'usage'; usage: UsageDTO }
  | { type: 'done'; assistantMessage: MessageDTO }
  | { type: 'error'; code: ErrorCode; message: string };

// ---------- Code (bulut kodlama oturumları) ----------
/** Ortamın ağ erişimi: none = yok, trusted = bilinen paket kaynakları, full = tüm internet (yerel ağ hariç), custom = kendi alan adı listen. */
export type CodeNetwork = 'none' | 'trusted' | 'full' | 'custom';

export interface GithubAccountDTO {
  login: string;
  avatarUrl: string;
}

export interface CodeCreditsDTO {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface CodeStatusDTO {
  /** Sunucuda GitHub OAuth ve sır anahtarı ayarlı mı? */
  available: boolean;
  /** Bu kullanıcı Code kullanabilir mi (izin listesi + doğrulanmış hesap)? */
  allowed: boolean;
  github: GithubAccountDTO | null;
  credits: CodeCreditsDTO;
}

export interface GithubRepoDTO {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string;
  pushedAt: string | null;
}

export interface GithubBranchesDTO {
  defaultBranch: string;
  branches: string[];
}

export interface CodeEnvironmentDTO {
  id: string;
  name: string;
  network: CodeNetwork;
  /** `network: 'custom'` iken izinli alan adları (`*.example.com` desteklenir). */
  allowedDomains: string[];
  /** Kurulum betiği: oturum çalışma alanı ilk hazırlandığında çalışır (ör. `npm ci`). */
  setupScript: string;
  /** Çalışma alanı disk tavanı (MB). */
  diskMb: number;
  /** Ortam değişkenleri. Yalnızca tek ortam okunurken döner, listede boştur. */
  envVars?: Record<string, string>;
  /** Listede gösterim için değişken adlarının sayısı. */
  envVarCount: number;
  /** Commit'lere oturum bağlantısı eklensin mi? (varsayılan kapalı) */
  commitSessionLink: boolean;
  /** Ajan tur sonunda commit'i GitHub'a itip PR açsın mı? (varsayılan açık) */
  autoPr: boolean;
  /** Her turun sistem istemine eklenen kalıcı talimatlar. */
  instructions: string;
  /** Bu ortamda kapatılan skill adları. */
  createdAt: string;
  updatedAt: string;
}

export type CodeSessionStatus = 'idle' | 'running' | 'error';

export interface CodeSessionDTO {
  chatId: string;
  title: string;
  repo: string;
  baseBranch: string;
  workBranch: string;
  environmentId: string | null;
  environmentName: string | null;
  status: CodeSessionStatus;
  diskUsedMb: number;
  /** Başlangıç commit'ine göre toplam değişiklik. */
  additions: number;
  deletions: number;
  filesChanged: number;
  headSha: string | null;
  /** GitHub'a en son itilen commit (headSha farklıysa itilmemiş iş var). */
  pushedSha: string | null;
  /** Ajanın açtığı PR (yoksa null). */
  prNumber: number | null;
  prUrl: string | null;
  /** Geri sarma sonrası bir sonraki push zorla yapılacak (uzak branch ileride). */
  forcePush: boolean;
  pinned: boolean;
  archived: boolean;
  /** Modele giden son bağlamın tahmini token sayısı ve üst sınırı (başlıktaki halka). */
  contextTokens: number;
  contextLimit: number;
  /** Son mesajdan kesit (liste kartında). */
  preview: string;
  createdAt: string;
  lastMessageAt: string | null;
}

/** Oturumdaki değişen bir dosya (başlangıç commit'ine göre). */
export interface CodeChangedFileDTO {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

/** Oturumdaki toplam değişiklik. `stale`: çalışma alanı o an okunamadı (ajan çalışıyor / alan uykuda); sayılar son bilinen toplamdır. */
export interface CodeChangesDTO {
  files: CodeChangedFileDTO[];
  additions: number;
  deletions: number;
  stale: boolean;
}

/** PR açmadan önce gösterilen model taslağı. */
export interface CodePrDraftDTO {
  title: string;
  body: string;
  base: string;
  head: string;
  commits: number;
  additions: number;
  deletions: number;
  files: number;
  /** headSha, GitHub'daki branch'ten ileride (itilecek iş var). */
  needsPush: boolean;
}

/** Birleşik fark (git diff). `stale`: ajan çalışırken ya da çalışma alanı okunamadığında boş döner. */
/** Önizleme bağlantısı: `url` sunucu köküne göredir (`/api/code/preview/<token>/…`); token kısa ömürlüdür. */
export interface CodePreviewDTO {
  url: string;
  expiresAt: string;
  kind: 'file' | 'port';
  /** Önizlenen giriş dosyası (statik) ya da port. */
  entry: string | number;
}

export interface CodeUploadDTO {
  /** Çalışma alanındaki yol (`.sixfinger/uploads/<ad>`); git'e girmez. */
  path: string;
  name: string;
  bytes: number;
}

export interface CodeDiffDTO {
  diff: string;
  truncated: boolean;
  stale: boolean;
}

/** Oturumun çalışma branch'indeki bir pull request. */
export interface CodePullDTO {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** Code oturumunda sunucuda bekleyen (sıraya eklenmiş) mesaj. */
export interface CodeQueueItemDTO {
  id: string;
  text: string;
  plan: boolean;
  /** Ek dosya adları. */
  attachments: string[];
}
