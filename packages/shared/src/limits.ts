/**
 * Kullanıcı katmanları:
 *  - guest:      Misafir. Hesap yok, kısıtlı özellikler, veriler geçici.
 *  - unverified: Kayıtlı ama e-postası doğrulanmamış.
 *  - member:     Kayıtlı ve e-postası doğrulanmış (tam özellik).
 */
export const TIERS = ['guest', 'unverified', 'member'] as const;
export type Tier = (typeof TIERS)[number];

export interface TierLimits {
  /** Günlük gönderilebilecek mesaj sayısı (yeniden üretmeler dahil). */
  dailyMessages: number;
  /** Tek mesajın azami karakter sayısı. */
  maxMessageChars: number;
  /** Saklanabilecek en fazla sohbet sayısı. */
  maxChats: number;
  /** Modele gönderilen geçmiş için yaklaşık token bütçesi. */
  contextTokens: number;
  /** Tek mesaja eklenebilecek en fazla dosya. */
  maxAttachments: number;
  /** Bir yanıtta modelin arka arkaya çağırabileceği en fazla araç turu. */
  maxToolSteps: number;
  features: {
    attachments: boolean;
    memory: boolean;
    customInstructions: boolean;
    share: boolean;
    exportAll: boolean;
    personas: boolean;
    pin: boolean;
    search: boolean;
    /** web_search ve web_fetch. */
    webTools: boolean;
    /** Sandbox araçları: bash, read, write, edit. Yalnızca doğrulanmış üyeler. */
    sandbox: boolean;
  };
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  guest: {
    dailyMessages: 15,
    maxMessageChars: 4_000,
    maxChats: 5,
    contextTokens: 6_000,
    maxAttachments: 0,
    maxToolSteps: 4,
    features: {
      attachments: false,
      memory: false,
      customInstructions: false,
      share: false,
      exportAll: false,
      personas: false,
      pin: false,
      search: false,
      webTools: true,
      sandbox: false,
    },
  },
  unverified: {
    dailyMessages: 40,
    maxMessageChars: 8_000,
    maxChats: 50,
    contextTokens: 12_000,
    maxAttachments: 0,
    maxToolSteps: 4,
    features: {
      attachments: false,
      memory: false,
      customInstructions: true,
      share: false,
      exportAll: true,
      personas: true,
      pin: true,
      search: true,
      webTools: true,
      sandbox: false,
    },
  },
  member: {
    dailyMessages: 300,
    maxMessageChars: 24_000,
    maxChats: 2_000,
    contextTokens: 28_000,
    maxAttachments: 4,
    maxToolSteps: 8,
    features: {
      attachments: true,
      memory: true,
      customInstructions: true,
      share: true,
      exportAll: true,
      personas: true,
      pin: true,
      search: true,
      webTools: true,
      sandbox: true,
    },
  },
};

export const ATTACHMENT_MAX_CHARS = 60_000;
export const GUEST_RETENTION_DAYS = 14;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const MEMORY_MAX_ITEMS = 50;
export const MEMORY_MAX_CHARS = 300;
