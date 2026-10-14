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
  TRUST_PROXY: bool,

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET en az 32 karakter olmalı'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(60),

  AI_BASE_URL: z.string().url().default('https://text.pollinations.ai/openai'),
  AI_MODEL: z.string().default('openai-fast'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),

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
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
  };
}
