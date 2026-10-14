import { z } from 'zod';
import { ATTACHMENT_MAX_CHARS, MEMORY_MAX_CHARS, PASSWORD_MAX, PASSWORD_MIN } from './limits.ts';

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

export const effortSchema = z.enum(['low', 'medium', 'high']);

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1),
  /** Düşünme derinliği: hızlı / dengeli / derin. */
  effort: effortSchema.optional(),
  /** Yeni mesajın bağlanacağı mesaj. Verilmezse sohbetin aktif ucu. Düzenlemede, düzenlenen mesajın üstü. */
  parentId: z.string().uuid().nullable().optional(),
  attachments: z.array(attachmentSchema).max(8).optional(),
});
export const regenerateSchema = z.object({
  /** Yeniden üretilecek asistan mesajı. */
  messageId: z.string().uuid(),
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
