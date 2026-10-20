export type Effort = 'low' | 'medium' | 'high';

export interface PendingAttachment {
  name: string;
  mime: string;
  /** Satır içi metin; sandbox'a yüklenecek/yüklenmiş dosyada boş (ya da yükleme başarısız olursa yedek). */
  text: string;
  truncated: boolean;
  /** Gönderimde sandbox'a yüklenecek ham dosya (base64). */
  data?: string;
  size?: number;
  /** Sandbox çalışma alanındaki yol (yüklendiyse). */
  path?: string;
  bytes?: number;
}
