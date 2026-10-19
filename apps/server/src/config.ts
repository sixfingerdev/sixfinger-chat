import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Derlenmiş web arayüzünün klasörü. Verilirse sunucu arayüzü de yayınlar (tek servis dağıtımı). */
  WEB_DIST: z.string().optional().default(''),
  TRUST_PROXY: bool,

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET en az 32 karakter olmalı'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(60),

  AI_BASE_URL: z.string().url().default('https://text.pollinations.ai/openai'),
  AI_MODEL: z.string().default('openai-fast'),
  AI_API_KEY: z.string().optional().default(''),
  /**
   * Çalışma modlarına göre sağlayıcılar. Hızlı = yukarıdaki AI_* (Pollinations). Dengeli ve Derin OVH AI Endpoints'te;
   * `*_BASE_URL` boş bırakılırsa o mod Hızlı sağlayıcıya düşer.
   */
  AI_BALANCED_BASE_URL: z.string().default('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions'),
  AI_BALANCED_MODEL: z.string().default('gpt-oss-120b'),
  AI_BALANCED_API_KEY: z.string().optional().default(''),
  AI_DEEP_BASE_URL: z.string().default('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions'),
  AI_DEEP_MODEL: z.string().default('Qwen3.8-27B'),
  AI_DEEP_API_KEY: z.string().optional().default(''),
  /**
   * Yedek: Amazon Bedrock'taki Claude (Converse API). Diğer sağlayıcılar hata verirse (hız sınırı, kesinti, 200 dışı yanıt,
   * boş yanıt) istek buraya düşer. `BEDROCK_MODEL_ID` ve bir kimlik bilgisi (API anahtarı ya da IAM anahtarı) verilmezse kapalıdır.
   */
  BEDROCK_MODEL_ID: z.string().optional().default(''),
  BEDROCK_REGION: z.string().optional().default('us-east-1'),
  BEDROCK_API_KEY: z.string().optional().default(''),
  BEDROCK_ACCESS_KEY_ID: z.string().optional().default(''),
  BEDROCK_SECRET_ACCESS_KEY: z.string().optional().default(''),
  BEDROCK_SESSION_TOKEN: z.string().optional().default(''),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  /** Üst servise bağlanma / ilk yanıt (başlıklar) ve akışsız çağrılar için süre. Akış başladıktan sonra uygulanmaz. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
  /** Akış sırasında bu kadar süre hiç veri gelmezse kopmuş sayılır. Uzun yanıtlar bundan etkilenmez. */
  AI_IDLE_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(90_000),
  /** Tek bir yanıtın mutlak üst süresi (araç turları ayrı sayılır). */
  AI_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(1_200_000),
  /** Bir yanıtta üretilebilecek en çok token (büyük artifact'lar için yüksek tutulur). */
  AI_MAX_TOKENS: z.coerce.number().int().min(256).default(32_768),
  BEDROCK_MAX_TOKENS: z.coerce.number().int().min(256).default(32_000),
  /** Model araç (web arama vb.) kullanabilsin mi? Kapalıysa yalnızca düz sohbet. */
  TOOLS_ENABLED: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),

  /** sandboxd adresi (ör. http://sandboxd:8791). Boşsa bash/read/write/edit araçları kapalıdır. */
  SANDBOXD_URL: z.string().optional().default(''),
  SANDBOXD_TOKEN: z.string().optional().default(''),

  /**
   * SixFinger Code. GitHub OAuth uygulaması (Client ID/Secret) ve token'ları şifreleyen anahtar (en az 32 karakter,
   * JWT_SECRET'tan ayrı; değiştirilirse kayıtlı GitHub bağlantıları ve ortam değişkenleri çözülemez). Üçü de yoksa Code kapalıdır.
   */
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  /** OAuth geri dönüş adresi. Boşsa PUBLIC_WEB_URL + /api/code/github/callback. GitHub uygulamasındaki adresle birebir aynı olmalı. */
  GITHUB_REDIRECT_URL: z.string().optional().default(''),
  CODE_SECRET_KEY: z.string().optional().default(''),
  /** Code kullanabilen e-postalar (virgülle). Boşsa kimse kullanamaz. `*` herkese (doğrulanmış üyelere) açar. */
  CODE_ALLOWED_EMAILS: z.string().optional().default(''),
  CODE_DAILY_CREDITS: z.coerce.number().min(1).default(100),
  /** Aynı anda çalışan Code oturumu (Pi 4 için 2) ve bekleme sırası uzunluğu. */
  CODE_MAX_RUNS: z.coerce.number().int().min(1).default(2),
  CODE_MAX_QUEUE: z.coerce.number().int().min(0).default(10),
  /** Modele gönderilen bağlam için tahmini token bütçesi (Qwen3.8 penceresi 262k; güvenli pay bırakılır). */
  CODE_CONTEXT_TOKENS: z.coerce.number().int().min(8_000).default(262_144),
  /** Bağlam bu orana dolunca eski konuşma özetlenir (kırpma yetmediğinde). */
  CODE_COMPACT_AT: z.coerce.number().min(0.4).max(0.95).default(0.8),
  /** Qwen başarısız olunca Claude'a (Bedrock) düşen Code isteklerinin tüm kullanıcılar için günlük token tavanı. 0 = yedek kapalı. */
  CODE_CLAUDE_DAILY_TOKENS: z.coerce.number().int().min(0).default(2_000_000),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().default('SixFinger <no-reply@localhost>'),
  SMTP_SECURE: bool,
});

export type Config = z.infer<typeof schema> & {
  corsOrigins: string[];
  smtpEnabled: boolean;
  codeAllowed: { all: boolean; emails: Set<string> };
  githubRedirectUrl: string;
  isProd: boolean;
  isTest: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Geçersiz ortam değişkenleri:\n${msg}`);
  }
  const c = parsed.data;
  const origins = c.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Capacitor (Android) WebView kaynakları
  for (const o of ['capacitor://localhost', 'https://localhost', 'http://localhost']) {
    if (!origins.includes(o)) origins.push(o);
  }
  return {
    ...c,
    corsOrigins: origins,
    smtpEnabled: Boolean(c.SMTP_HOST),
    codeAllowed: {
      all: c.CODE_ALLOWED_EMAILS.trim() === '*',
      emails: new Set(
        c.CODE_ALLOWED_EMAILS.split(',')
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e && e !== '*'),
      ),
    },
    githubRedirectUrl: c.GITHUB_REDIRECT_URL || `${c.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/code/github/callback`,
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
  };
}
