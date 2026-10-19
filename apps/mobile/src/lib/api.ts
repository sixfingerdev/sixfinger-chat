import type {
  AuthResponse,
  ChatDTO,
  ChatDetailDTO,
  CodeChangesDTO,
  CodeDiffDTO,
  SlashCommand,
  CodeEnvironmentDTO,
  CodeQueueItemDTO,
  CodePreviewDTO,
  SkillDetailDTO,
  SkillListItemDTO,
  McpApprovalDTO,
  McpPresetsResponse,
  McpScope,
  McpServerDTO,
  McpServersResponse,
  CodeUploadDTO,
  CodePullDTO,
  CodeSessionDTO,
  CodeStatusDTO,
  ConfigDTO,
  ErrorCode,
  GithubBranchesDTO,
  GithubRepoDTO,
  MemoryDTO,
  MessageDTO,
  Persona,
  ModelInfo,
  SessionDTO,
  SharedChatDTO,
  StreamEvent,
  UserDTO,
  UsageDTO,
} from '@sixfinger/shared';
import { fetch } from 'expo/fetch';
import { secureSession } from './storage.ts';

/** Uygulamanın sunucusu. Derleme sırasında EXPO_PUBLIC_API_URL ile değiştirilebilir (geliştirme/test için). */
export const DEFAULT_API_BASE: string = (process.env.EXPO_PUBLIC_API_URL ?? 'https://chat.sixfinger.live').replace(/\/$/, '');

export function getApiBase(): string {
  return DEFAULT_API_BASE;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | 'network',
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------- Oturum depolama ----------
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const sessionStore = {
  read(): StoredSession | null {
    const raw = secureSession.get();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },
  write(auth: AuthResponse): void {
    const s: StoredSession = {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresAt: Date.now() + auth.expiresIn * 1000,
    };
    secureSession.set(JSON.stringify(s));
  },
  clear(): void {
    secureSession.clear();
  },
};

let onSessionRefreshed: ((auth: AuthResponse) => void) | undefined;
let onSessionLost: (() => void) | undefined;
export function bindSessionEvents(handlers: { refreshed: (a: AuthResponse) => void; lost: () => void }) {
  onSessionRefreshed = handlers.refreshed;
  onSessionLost = handlers.lost;
}

// ---------- Yenileme (aynı anda tek seferde) ----------
let refreshing: Promise<boolean> | null = null;

async function doRefresh(failedToken: string | undefined): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const current = sessionStore.read();
    if (!current) return false;
    // Bu arada başka bir istek yenilediyse tekrar yenileme.
    if (failedToken && current.accessToken !== failedToken) return true;
    try {
      const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 400) {
          sessionStore.clear();
          onSessionLost?.();
        }
        return false;
      }
      const auth = (await res.json()) as AuthResponse;
      sessionStore.write(auth);
      onSessionRefreshed?.(auth);
      return true;
    } catch {
      return false; // ağ hatası: oturumu silme
    }
  };
  return run();
}

function refreshSession(failedToken: string | undefined): Promise<boolean> {
  refreshing ??= doRefresh(failedToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: ErrorCode; message?: string; details?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    /* gövde yok */
  }
  return new ApiError(res.status, body.error?.code ?? 'internal', body.error?.message ?? `Hata (${res.status})`, body.error?.details);
}

interface ReqOptions {
  auth?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: ReqOptions['query']): string {
  const url = `${getApiBase()}/api${path}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

async function send(method: string, path: string, body: unknown, opts: ReqOptions, retry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const session = opts.auth === false ? null : sessionStore.read();
  if (session) headers.authorization = `Bearer ${session.accessToken}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Sunucuya ulaşılamıyor. Bağlantını kontrol et.');
  }
  if (res.status === 401 && retry && session && opts.auth !== false) {
    if (await refreshSession(session.accessToken)) return send(method, path, body, opts, false);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown, opts: ReqOptions = {}): Promise<T> {
  const res = await send(method, path, body, opts);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** SSE gövdesini okuyup olayları tek tek `onEvent`'e verir. */
async function readEvents(res: Response, onEvent: (e: StreamEvent) => void): Promise<void> {
  if (!res.body) throw new ApiError(0, 'network', 'Akış açılamadı.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
          } catch {
            /* bozuk parça */
          }
        }
      }
    }
  } catch (err) {
    // Okuma sırasında kopma (ör. uygulama arka plana alındı): çağıran yeniden bağlanabilsin diye ağ hatası olarak bildir.
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Bağlantı koptu.');
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** SSE akışı (POST): sunucu olaylarını tek tek `onEvent`'e verir. */
export async function streamRequest(
  path: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await send('POST', path, body, { signal });
  if (!res.ok) throw await parseError(res);
  await readEvents(res, onEvent);
}

/** Süren bir üretimi izler (GET): üretim yoksa (204) hemen döner. */
export async function streamGet(path: string, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await send('GET', path, undefined, { signal });
  if (res.status === 204) return;
  if (!res.ok) throw await parseError(res);
  await readEvents(res, onEvent);
}

// ---------- Uç noktalar ----------
export type FullConfig = ConfigDTO & { personas: Persona[]; models: ModelInfo[] };

export const api = {
  // auth
  guest: (locale: 'tr' | 'en') => request<AuthResponse>('POST', '/auth/guest', { locale }, { auth: false }),
  register: (p: { email: string; password: string; displayName?: string; locale: 'tr' | 'en' }) =>
    request<AuthResponse>('POST', '/auth/register', p),
  login: (p: { email: string; password: string }) => request<AuthResponse>('POST', '/auth/login', p, { auth: false }),
  logout: (refreshToken: string) => request<void>('POST', '/auth/logout', { refreshToken }, { auth: false }),
  verify: (code: string) => request<{ user: UserDTO }>('POST', '/auth/verify', { code }),
  resendVerify: () => request<void>('POST', '/auth/verify/resend'),
  forgot: (email: string) => request<void>('POST', '/auth/forgot', { email }, { auth: false }),
  reset: (p: { email: string; code: string; password: string }) => request<void>('POST', '/auth/reset', p, { auth: false }),
  changePassword: (p: { currentPassword: string; newPassword: string }) => request<void>('POST', '/auth/password', p),

  // profil
  me: () => request<{ user: UserDTO }>('GET', '/me'),
  config: () => request<FullConfig>('GET', '/config'),
  usage: () => request<UsageDTO>('GET', '/usage'),
  updateMe: (p: object) => request<{ user: UserDTO }>('PATCH', '/me', p),
  deleteMe: (password?: string) => request<void>('DELETE', '/me', { password }),
  sessions: () => request<{ sessions: SessionDTO[] }>('GET', '/me/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/me/sessions/${id}`),
  exportAll: () => request<unknown>('GET', '/me/export'),

  // hafıza
  memories: () => request<{ memories: MemoryDTO[] }>('GET', '/memories'),
  addMemory: (content: string) => request<{ memory: MemoryDTO }>('POST', '/memories', { content }),
  deleteMemory: (id: string) => request<void>('DELETE', `/memories/${id}`),
  clearMemories: () => request<void>('DELETE', '/memories'),

  // sohbetler
  chats: (q?: { q?: string; archived?: boolean }) =>
    request<{ chats: ChatDTO[] }>('GET', '/chats', undefined, { query: { q: q?.q, archived: q?.archived } }),
  createChat: (p: { title?: string; personaId?: string } = {}) => request<{ chat: ChatDTO }>('POST', '/chats', p),
  chat: (id: string) => request<ChatDetailDTO>('GET', `/chats/${id}`),
  stopChat: (id: string) => request<{ stopped: boolean }>('POST', `/chats/${id}/stop`),
  updateChat: (id: string, p: object) => request<{ chat: ChatDTO }>('PATCH', `/chats/${id}`, p),
  deleteChat: (id: string) => request<void>('DELETE', `/chats/${id}`),
  deleteAllChats: () => request<void>('DELETE', '/chats'),
  share: (id: string) => request<{ slug: string; url: string }>('POST', `/chats/${id}/share`),
  unshare: (id: string) => request<void>('DELETE', `/chats/${id}/share`),
  feedback: (messageId: string, value: 1 | -1 | null) =>
    request<{ message: MessageDTO }>('PUT', `/messages/${messageId}/feedback`, { value }),
  shared: (slug: string) => request<SharedChatDTO>('GET', `/public/shares/${slug}`, undefined, { auth: false }),

  // Code
  codeStatus: () => request<CodeStatusDTO>('GET', '/code/status'),
  codeGithubStart: () => request<{ url: string }>('POST', '/code/github/start', { target: 'app' }),
  codeGithubComplete: (code: string, state: string) =>
    request<{ github: { login: string; avatarUrl: string } }>('POST', '/code/github/complete', { code, state }),
  codeGithubDisconnect: () => request<void>('DELETE', '/code/github'),
  codeRepos: (q?: string) => request<{ repos: GithubRepoDTO[] }>('GET', '/code/repos', undefined, { query: { q } }),
  codeBranches: (repo: string) => request<GithubBranchesDTO>('GET', '/code/branches', undefined, { query: { repo } }),
  codeEnvironments: () => request<{ environments: CodeEnvironmentDTO[] }>('GET', '/code/environments'),
  codeEnvironment: (id: string) => request<{ environment: CodeEnvironmentDTO }>('GET', `/code/environments/${id}`),
  codeCreateEnvironment: (p: object) => request<{ environment: CodeEnvironmentDTO }>('POST', '/code/environments', p),
  codeUpdateEnvironment: (id: string, p: object) => request<{ environment: CodeEnvironmentDTO }>('PATCH', `/code/environments/${id}`, p),
  codeDeleteEnvironment: (id: string) => request<void>('DELETE', `/code/environments/${id}`),
  codeSessions: (archived = false) => request<{ sessions: CodeSessionDTO[] }>('GET', `/code/sessions${archived ? '?archived=true' : ''}`),
  codeSession: (id: string) => request<{ session: CodeSessionDTO }>('GET', `/code/sessions/${id}`),
  codeCreateSession: (p: { repo: string; baseBranch: string; environmentId?: string }) =>
    request<{ session: CodeSessionDTO }>('POST', '/code/sessions', p),
  codeCommands: (id: string) => request<{ commands: SlashCommand[] }>('GET', `/code/sessions/${id}/commands`),
  codeFiles: (id: string, q?: string) => request<{ files: string[]; truncated: boolean }>('GET', `/code/sessions/${id}/files${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  codePulls: (id: string) => request<{ pulls: CodePullDTO[] }>('GET', `/code/sessions/${id}/pulls`),
  codeDiff: (id: string, path?: string) => request<CodeDiffDTO>('GET', `/code/sessions/${id}/diff${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  codeFile: (id: string, path: string) => request<{ path: string; content: string; truncated: boolean }>('GET', `/code/sessions/${id}/file?path=${encodeURIComponent(path)}`),
  codeRewind: (id: string, messageId: string) => request<{ sha: string; session: CodeSessionDTO }>('POST', `/code/sessions/${id}/rewind`, { messageId }),
  /** Arşiv indirme adresi ve yetki başlığı (dosya sistemi indiricisine verilir). */
  codeArchiveRequest: (id: string) => ({ url: `${getApiBase()}/api/code/sessions/${id}/archive`, headers: { authorization: `Bearer ${sessionStore.read()?.accessToken ?? ''}` } }),
  /** Önizleme bağlantısı (kısa ömürlü token'lı); `url` sunucu köküne göredir. */
  codePreview: (id: string, body: { path?: string; port?: number; root?: string }) => request<CodePreviewDTO>('POST', `/code/sessions/${id}/preview`, body),
  codeUpload: (id: string, name: string, dataBase64: string) => request<CodeUploadDTO>('POST', `/code/sessions/${id}/upload`, { name, dataBase64 }),
  /** Tek dosya indirme adresi ve yetki başlığı. */
  codeDownloadRequest: (id: string, path: string) => ({ url: `${getApiBase()}/api/code/sessions/${id}/download?path=${encodeURIComponent(path)}`, headers: { authorization: `Bearer ${sessionStore.read()?.accessToken ?? ''}` } }),
  // ---- skill'ler ----
  codeSkills: () => request<{ skills: SkillListItemDTO[]; limits: { perUser: number; own: number } }>('GET', '/code/skills'),
  codeSkill: (name: string, source?: 'builtin') => request<SkillDetailDTO>('GET', `/code/skills/${encodeURIComponent(name)}${source ? `?source=${source}` : ''}`),
  codeSaveSkill: (name: string | null, body: { markdown: string; files?: Record<string, string> }) =>
    name ? request<SkillDetailDTO>('PUT', `/code/skills/${encodeURIComponent(name)}`, body) : request<SkillDetailDTO>('POST', '/code/skills', body),
  codeDeleteSkill: (name: string) => request<void>('DELETE', `/code/skills/${encodeURIComponent(name)}`),
  codeImportSkill: (url: string, overwrite = false) => request<{ imported: SkillListItemDTO[]; skipped: number }>('POST', '/code/skills/import', { url, overwrite }),
  codeShareSkill: (name: string, enabled: boolean) => request<{ shareToken: string | null }>('POST', `/code/skills/${encodeURIComponent(name)}/share`, { enabled }),
  codeSharedSkill: (token: string) => request<SkillDetailDTO>('GET', `/code/skills/shared/${encodeURIComponent(token)}`),
  // ---- MCP bağlayıcıları ----
  mcpPresets: () => request<McpPresetsResponse>('GET', '/mcp/presets'),
  mcpServers: () => request<McpServersResponse>('GET', '/mcp/servers'),
  mcpCreate: (body: { label: string; url: string; preset?: string; headers?: Record<string, string>; scopes?: McpScope[] }) => request<{ server: McpServerDTO }>('POST', '/mcp/servers', body),
  mcpUpdate: (id: string, body: { label?: string; url?: string; headers?: Record<string, string>; enabled?: boolean; scopes?: McpScope[]; autoApprove?: boolean; allowTools?: string[] }) =>
    request<{ server: McpServerDTO }>('PATCH', `/mcp/servers/${id}`, body),
  mcpDelete: (id: string) => request<void>('DELETE', `/mcp/servers/${id}`),
  mcpRefresh: (id: string) => request<{ server: McpServerDTO }>('POST', `/mcp/servers/${id}/refresh`),
  /** OAuth: tarayıcıda açılacak adresi döndürür (zaten yetkiliyse authorizeUrl null). */
  mcpConnect: (id: string, target: 'web' | 'app') => request<{ authorizeUrl: string | null; server: McpServerDTO }>('POST', `/mcp/servers/${id}/connect`, { target }),
  mcpDisconnect: (id: string) => request<{ server: McpServerDTO }>('POST', `/mcp/servers/${id}/disconnect`),
  mcpComplete: (code: string, state: string) => request<{ server: McpServerDTO }>('POST', '/mcp/oauth/complete', { code, state }),
  mcpApproval: (id: string) => request<{ approval: McpApprovalDTO }>('GET', `/mcp/approvals/${id}`),
  mcpDecide: (id: string, decision: 'once' | 'always' | 'deny') => request<{ approval: McpApprovalDTO }>('POST', `/mcp/approvals/${id}`, { decision }),
  codeImportShared: (token: string, overwrite = false) => request<SkillDetailDTO>('POST', `/code/skills/shared/${encodeURIComponent(token)}/import`, { overwrite }),
  codePush: (id: string) => request<{ sha: string; branch: string }>('POST', `/code/sessions/${id}/push`),
  /** PR'ı ajan açar (başlık/açıklamayı model yazar): otomatik adım başarısız olduğunda ya da "Otomatik PR" kapalıyken yeniden deneme. */
  /** Sunucu tarafı mesaj kuyruğu (Code): çalışırken eklenen mesajlar sunucuda bekler, tur bitince sunucu başlatır. */
  codeQueue: (id: string) => request<{ queue: CodeQueueItemDTO[] }>('GET', `/chats/${id}/queue`),
  codeEnqueue: (id: string, body: { content: string; planMode?: boolean; attachments?: Array<{ name: string; mime: string; text: string }> }) =>
    request<{ queue: CodeQueueItemDTO[]; started: boolean }>('POST', `/chats/${id}/queue`, body),
  codeQueueRemove: (id: string, queueId: string) => request<void>('DELETE', `/chats/${id}/queue/${queueId}`),
  codeOpenPr: (id: string) => request<{ pull: CodePullDTO | null; created: boolean; existed: boolean; sha: string }>('POST', `/code/sessions/${id}/pr`, {}),
  codeChanges: (id: string) => request<CodeChangesDTO>('GET', `/code/sessions/${id}/changes`),
  codeDeleteSession: (id: string) => request<void>('DELETE', `/code/sessions/${id}`),
};
