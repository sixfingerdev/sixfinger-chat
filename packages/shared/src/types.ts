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
  pinned: boolean;
  archived: boolean;
  leafId: string | null;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  /** Arama sonuçlarında eşleşen mesajdan kesit. */
  snippet?: string;
}

export interface AttachmentDTO {
  name: string;
  mime: string;
  text: string;
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
      ms?: number;
    };

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
  | 'internal';

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------- Akış (SSE) olayları ----------
export type StreamEvent =
  | { type: 'start'; userMessage: MessageDTO | null; assistantMessage: MessageDTO }
  | { type: 'reasoning'; delta: string }
  | { type: 'delta'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; id: string; status: ToolStatus; output: string; summary?: string; ms: number }
  | { type: 'title'; title: string }
  | { type: 'memory'; memory: MemoryDTO }
  | { type: 'usage'; usage: UsageDTO }
  | { type: 'done'; assistantMessage: MessageDTO }
  | { type: 'error'; code: ErrorCode; message: string };
