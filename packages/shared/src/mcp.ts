/**
 * MCP (Model Context Protocol) bağlayıcıları: kullanıcının eklediği uzak MCP sunucuları. Ajanlar (Chat ve Code) sunucuların araçlarını
 * `mcp__<sunucu>__<araç>` adıyla kullanır; değiştiren araçlar kullanıcıdan onay ister. Bu dosya DTO'ları ve sınırları içerir
 * (sunucu, web ve mobil ortak); hazır katalog `mcp-presets.ts`'tedir.
 */

export type McpAuthKind = 'none' | 'headers' | 'oauth';
export type McpScope = 'chat' | 'code';

export const MCP_LIMITS = {
  /** Kullanıcı başına sunucu. */
  servers: 10,
  /** Sunucu başına önbelleklenen araç. */
  tools: 100,
  /** Özel başlık sayısı ve değer uzunluğu. */
  headers: 10,
  headerValue: 2_000,
  /** Modele bir turda gösterilen MCP aracı sayısı (bağlamı şişirmemek için). */
  modelTools: 40,
  /** Araç çağrısı zaman aşımı (sn). */
  callSeconds: 60,
  /** Bekleyen onayın geçerlilik süresi (dk). */
  approvalMinutes: 30,
} as const;

export interface McpToolDTO {
  name: string;
  description: string;
  /** `annotations.readOnlyHint`: true ise onay istemeden çalışır. */
  readOnly: boolean;
  /** Bu araç için "hep izin ver" açık mı (ya da sunucu geneli otomatik onay). */
  allowed: boolean;
}

export interface McpServerDTO {
  id: string;
  /** Araç adlarında kullanılan kısa ad (`[a-z0-9-]`). */
  name: string;
  label: string;
  url: string;
  /** Hazır katalog kimliği (özel sunucuysa null). */
  preset: string | null;
  authKind: McpAuthKind;
  /** Kayıtlı başlıkların adları (değerler asla dönmez). */
  headerNames: string[];
  /** OAuth: yetki verilmiş mi; başlıklı: en az bir başlık var mı; yetkisiz: her zaman true. */
  connected: boolean;
  enabled: boolean;
  scopes: McpScope[];
  autoApprove: boolean;
  allowTools: string[];
  tools: McpToolDTO[];
  toolsAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export type McpApprovalStatus = 'pending' | 'approved' | 'denied' | 'used';

/** Onay bekleyen araç çağrısı (kartta gösterilir). */
export interface McpApprovalDTO {
  id: string;
  chatId: string;
  serverId: string;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  status: McpApprovalStatus;
  createdAt: string;
}

/** Araç parçasının `meta.approval` alanı: kart bu bilgiyle çizilir. */
export interface McpApprovalMeta {
  id: string;
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

/** Tool parçasının adı MCP aracı mı? */
export const isMcpToolName = (name: string): boolean => name.startsWith('mcp__');

/** `mcp__<sunucu>__<araç>` → { server, tool }; MCP adı değilse null. */
export function splitMcpToolName(name: string): { server: string; tool: string } | null {
  if (!isMcpToolName(name)) return null;
  const rest = name.slice(5);
  const i = rest.indexOf('__');
  if (i <= 0) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/** Ekleme/düzenleme bildiriminde kısaltılmış adres (arayüz). */
export function mcpHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
