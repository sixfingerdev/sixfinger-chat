import type { AuthUser } from '../../lib/types.ts';

export interface ToolContext {
  user: AuthUser;
  signal: AbortSignal;
  /** Araçların sohbet başına izole çalışma alanı için. */
  chatId?: string;
  /** Yalnızca SixFinger Code oturumlarında: çalışma alanı bağlamı. */
  code?: CodeToolContext;
}

export interface CodeToolContext {
  /** sandboxd oturum anahtarı. */
  session: string;
  /** Çalışma alanı disk tavanı (MB). */
  diskMb: number;
  /** Çalışma alanını (yeniden) hazırlar; sandboxd yeniden başlamışsa araçlar bir kez bunu çağırıp tekrar dener. */
  prepare(): Promise<void>;
}

export interface ToolResult {
  /** Modele geri verilen metin. */
  output: string;
  /** Kartta gösterilen tek satır. */
  summary?: string;
  /** İstemcinin zengin gösterim için kullandığı yapısal veri (dosya +N −M, çıkış kodu, yapılacaklar...). Modele gitmez. */
  meta?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON şeması (modele gider). */
  parameters: Record<string, unknown>;
  /** Modele geri verilen çıktının üst sınırı (karakter). Varsayılan `MAX_TOOL_OUTPUT_CHARS`. */
  maxOutputChars?: number;
  /** Modelin sık yaptığı argüman adı hataları: { asılAd: [takmaAdlar] }. */
  aliases?: Record<string, string[]>;
  /** Bu kullanıcı için kullanılabilir mi? */
  available(user: AuthUser): boolean;
  /** Girdi doğrulanmış olarak çağrılır; hata için ToolError fırlatılır. */
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
