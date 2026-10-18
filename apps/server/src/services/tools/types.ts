import type { AuthUser } from '../../lib/types.ts';

export interface ToolContext {
  user: AuthUser;
  signal: AbortSignal;
  /** Araçların sohbet başına izole çalışma alanı için. */
  chatId?: string;
}

export interface ToolResult {
  /** Modele geri verilen metin. */
  output: string;
  /** Kartta gösterilen tek satır. */
  summary?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON şeması (modele gider). */
  parameters: Record<string, unknown>;
  /** Bu kullanıcı için kullanılabilir mi? */
  available(user: AuthUser): boolean;
  /** Girdi doğrulanmış olarak çağrılır; hata için ToolError fırlatılır. */
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
