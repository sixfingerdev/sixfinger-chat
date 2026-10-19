import { z } from 'zod';
import {
  ATTACHMENT_MAX_CHARS,
  CODE_DISK_MAX_MB,
  CODE_DISK_MIN_MB,
  CODE_MAX_ENV_VARS,
  MEMORY_MAX_CHARS,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from './limits.ts';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
const locale = z.enum(['tr', 'en']);

// ---------- Auth ----------
export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(60).optional(),
  locale: locale.optional(),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) });
export const guestSchema = z.object({ locale: locale.optional() });
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export const verifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/),
  password,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: password,
});
export const deleteAccountSchema = z.object({ password: z.string().max(PASSWORD_MAX).optional() });

// ---------- Profil / ayarlar ----------
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    locale,
    settings: z
      .object({
        customName: z.string().trim().max(60),
        about: z.string().trim().max(1_000),
        instructions: z.string().trim().max(1_500),
        defaultPersona: z.string().max(40),
        memoryEnabled: z.boolean(),
      })
      .partial(),
  })
  .partial();

// ---------- Sohbetler ----------
export const createChatSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  personaId: z.string().max(40).optional(),
});
export const updateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    pinned: z.boolean(),
    archived: z.boolean(),
    personaId: z.string().max(40),
    leafId: z.string().uuid(),
  })
  .partial();
export const listChatsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  archived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mime: z.string().max(100).default('text/plain'),
  text: z.string().max(ATTACHMENT_MAX_CHARS),
});
export type AttachmentInput = z.infer<typeof attachmentSchema>;

/** Düşünme düzeyi (`reasoning_effort`). */
export const effortSchema = z.enum(['low', 'medium', 'high']);
/** Çalışma modu: hangi model yanıtlar. */
export const modeSchema = z.enum(['fast', 'balanced', 'deep']);

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1),
  /** Çalışma modu. Eski istemcilerde yoktur; o zaman `effort` modu belirler. */
  mode: modeSchema.optional(),
  /** Düşünme düzeyi (modu destekliyorsa). */
  effort: effortSchema.optional(),
  /** Yeni mesajın bağlanacağı mesaj. Verilmezse sohbetin aktif ucu. Düzenlemede, düzenlenen mesajın üstü. */
  parentId: z.string().uuid().nullable().optional(),
  attachments: z.array(attachmentSchema).max(8).optional(),
});
export const regenerateSchema = z.object({
  /** Yeniden üretilecek asistan mesajı. */
  messageId: z.string().uuid(),
  mode: modeSchema.optional(),
  effort: effortSchema.optional(),
});
export const feedbackSchema = z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) });

// ---------- Hafıza ----------
export const memorySchema = z.object({ content: z.string().trim().min(2).max(MEMORY_MAX_CHARS) });

// ---------- Tipler ----------
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ---------- Code ----------
export const githubStartSchema = z.object({ target: z.enum(['web', 'app']).default('web') });
/** GitHub'dan dönen tek kullanımlık kod + imzalı `state`; bağlantıyı oturumlu istemci tamamlar. */
export const githubCompleteSchema = z.object({ code: z.string().min(1).max(200), state: z.string().min(1).max(2_000) });

const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Sandbox'ın kendi çalışmasını bozacak ya da ağ yalıtımını delecek adlar. */
const RESERVED_ENV = /^(PATH|HOME|USER|SHELL|PWD|LD_.*|DYLD_.*|NODE_OPTIONS|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|GIT_(ASKPASS|SSH.*|CONFIG.*|EXEC_PATH))$/i;

export const codeEnvFields = z.object({
  name: z.string().trim().min(1).max(40),
  network: z.enum(['none', 'trusted', 'full', 'custom']),
  allowedDomains: z
    .array(z.string().trim().toLowerCase().regex(DOMAIN_RE, 'geçersiz alan adı'))
    .max(50)
    .transform((a) => [...new Set(a)]),
  setupScript: z.string().max(4_000),
  diskMb: z.number().int().min(CODE_DISK_MIN_MB).max(CODE_DISK_MAX_MB),
  commitSessionLink: z.boolean(),
  envVars: z
    .record(z.string().max(4_000))
    .refine((o) => Object.keys(o).length <= CODE_MAX_ENV_VARS, `en fazla ${CODE_MAX_ENV_VARS} değişken`)
    .refine((o) => Object.keys(o).every((k) => ENV_NAME_RE.test(k)), 'geçersiz değişken adı')
    .refine((o) => !Object.keys(o).some((k) => RESERVED_ENV.test(k)), 'bu değişken adı ayrılmış'),
});
export const createCodeEnvSchema = codeEnvFields.partial({
  network: true,
  allowedDomains: true,
  setupScript: true,
  diskMb: true,
  commitSessionLink: true,
  envVars: true,
});
export const updateCodeEnvSchema = codeEnvFields.partial();
export const createCodeSessionSchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'owner/repo biçiminde olmalı')
    // `..` GitHub adresinde yol atlamasına yol açar (/repos/../user).
    .refine((r) => r.split('/').every((p) => p !== '.' && p !== '..'), 'owner/repo biçiminde olmalı'),
  baseBranch: z.string().trim().min(1).max(200),
  environmentId: z.string().uuid().optional(),
});
export const listReposQuery = z.object({ q: z.string().trim().max(100).optional() });
export const branchesQuery = z.object({ repo: createCodeSessionSchema.shape.repo });
