import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  changePasswordSchema,
  forgotSchema,
  guestSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetSchema,
  verifySchema,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/crypto.ts';
import { HttpError, unauthorized } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { findUserByEmail, findUserById, toUserDTO } from '../services/users.ts';

const clientOf = (req: FastifyRequest) => ({
  userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  ip: req.ip ?? null,
});

const GUEST_NAMES = { tr: 'Misafir', en: 'Guest' } as const;

export function authRoutes(ctx: AppContext, guard: Guard) {
  const { db, sessions, codes, mailer, log } = ctx;

  async function sendCodeSafely(
    to: string,
    purpose: 'verify' | 'reset',
    userId: string | null,
    locale: 'tr' | 'en',
  ) {
    const code = await codes.create(userId, to, purpose);
    try {
      await mailer.sendCode({ to, code, purpose, locale });
    } catch (err) {
      log.error({ err, to, purpose }, 'e-posta gönderilemedi');
      throw new HttpError(502, 'internal', 'E-posta gönderilemedi. Biraz sonra tekrar dene.');
    }
  }

  return async function (app: FastifyInstance) {
    // --- Misafir ---
    app.post(
      '/auth/guest',
      { config: { rateLimit: { max: 8, timeWindow: '1 hour' } } },
      async (req, reply) => {
        const body = parse(guestSchema, req.body);
        const locale = body.locale ?? 'tr';
        const r = await db.query<{ id: string }>(
          `insert into users (display_name, is_guest, locale) values ($1, true, $2) returning id`,
          [GUEST_NAMES[locale], locale],
        );
        const id = r.rows[0]!.id;
        await db.query('insert into user_settings (user_id) values ($1)', [id]);
        return reply.code(201).send(await sessions.issue(id, clientOf(req)));
      },
    );

    // --- Kayıt (misafir hesabı yükseltme dahil) ---
    app.post(
      '/auth/register',
      { preHandler: guard.optionalUser, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const body = parse(registerSchema, req.body);
        const email = body.email;
        if (await findUserByEmail(db, email)) {
          throw new HttpError(409, 'email_taken', 'Bu e-posta ile zaten bir hesap var.');
        }
        const passwordHash = await hashPassword(body.password);
        const locale = body.locale ?? req.user?.locale ?? 'tr';
        const displayName = body.displayName ?? email.split('@')[0]!.slice(0, 60);

        let userId: string;
        try {
          if (req.user?.isGuest) {
            userId = req.user.id;
            await db.query(
              `update users set email = $2, password_hash = $3, display_name = $4, locale = $5,
                                is_guest = false, updated_at = now()
                where id = $1`,
              [userId, email, passwordHash, displayName, locale],
            );
            // Misafir oturumu yerine yeni bir oturum açılacak.
            await sessions.revokeAllForUser(db, userId);
          } else {
            const r = await db.query<{ id: string }>(
              `insert into users (email, password_hash, display_name, locale) values ($1, $2, $3, $4) returning id`,
              [email, passwordHash, displayName, locale],
            );
            userId = r.rows[0]!.id;
            await db.query('insert into user_settings (user_id) values ($1)', [userId]);
          }
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new HttpError(409, 'email_taken', 'Bu e-posta ile zaten bir hesap var.');
          }
          throw err;
        }
        // Kod gönderimi başarısız olsa bile hesap oluşturuldu; kullanıcı sonradan "tekrar gönder" diyebilir.
        sendCodeSafely(email, 'verify', userId, locale).catch(() => {});
        return reply.code(201).send(await sessions.issue(userId, clientOf(req)));
      },
    );

    // --- Giriş ---
    app.post(
      '/auth/login',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req) => {
        const body = parse(loginSchema, req.body);
        const user = await findUserByEmail(db, body.email);
        if (!user?.password_hash) {
          await burnPasswordCheck(body.password);
          throw new HttpError(401, 'invalid_credentials', 'E-posta ya da şifre hatalı.');
        }
        if (!(await verifyPassword(body.password, user.password_hash))) {
          throw new HttpError(401, 'invalid_credentials', 'E-posta ya da şifre hatalı.');
        }
        return sessions.issue(user.id, clientOf(req));
      },
    );

    app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
      const { refreshToken } = parse(refreshSchema, req.body);
      return sessions.refresh(refreshToken, clientOf(req));
    });

    app.post('/auth/logout', async (req, reply) => {
      const token = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
      if (typeof token === 'string' && token.length < 200) await sessions.revoke(token);
      return reply.code(204).send();
    });

    // --- E-posta doğrulama ---
    app.post(
      '/auth/verify',
      { preHandler: guard.requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req) => {
        const user = req.user!;
        if (user.isGuest || !user.email) throw new HttpError(400, 'bad_request', 'Önce hesap oluşturmalısın.');
        const { code } = parse(verifySchema, req.body);
        await codes.consume(user.email, 'verify', code);
        await db.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [
          user.id,
        ]);
        const fresh = await findUserById(db, user.id);
        return { user: toUserDTO(fresh!) };
      },
    );

    app.post(
      '/auth/verify/resend',
      { preHandler: guard.requireUser, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
      async (req, reply) => {
        const user = req.user!;
        if (user.isGuest || !user.email) throw new HttpError(400, 'bad_request', 'Önce hesap oluşturmalısın.');
        if (user.emailVerified) throw new HttpError(400, 'bad_request', 'E-postan zaten doğrulanmış.');
        await sendCodeSafely(user.email, 'verify', user.id, user.locale);
        return reply.code(204).send();
      },
    );

    // --- Şifre sıfırlama ---
    app.post(
      '/auth/forgot',
      { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
      async (req, reply) => {
        const { email } = parse(forgotSchema, req.body);
        const user = await findUserByEmail(db, email);
        // Hesap var mı yok mu sızdırma: her durumda 204.
        if (user?.password_hash) {
          await sendCodeSafely(email, 'reset', user.id, user.locale).catch((err) => {
            if (err instanceof HttpError && err.status === 429) return; // bekleme süresi: sessizce yut
            log.error({ err }, 'şifre sıfırlama kodu gönderilemedi');
          });
        }
        return reply.code(204).send();
      },
    );

    app.post(
      '/auth/reset',
      { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
      async (req, reply) => {
        const body = parse(resetSchema, req.body);
        const user = await findUserByEmail(db, body.email);
        if (!user?.password_hash) throw new HttpError(400, 'invalid_code', 'Kod geçersiz ya da süresi dolmuş.');
        await codes.consume(body.email, 'reset', body.code);
        const hash = await hashPassword(body.password);
        await db.query(
          `update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
            where id = $1`,
          [user.id, hash],
        );
        await sessions.revokeAllForUser(db, user.id);
        return reply.code(204).send();
      },
    );

    // --- Şifre değiştirme ---
    app.post('/auth/password', { preHandler: guard.requireUser }, async (req, reply) => {
      const user = req.user!;
      const body = parse(changePasswordSchema, req.body);
      const row = await findUserById(db, user.id);
      if (!row?.password_hash) throw unauthorized();
      if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
        throw new HttpError(401, 'invalid_credentials', 'Mevcut şifre hatalı.');
      }
      await db.query('update users set password_hash = $2, updated_at = now() where id = $1', [
        user.id,
        await hashPassword(body.newPassword),
      ]);
      await sessions.revokeAllForUser(db, user.id, user.sessionId);
      return reply.code(204).send();
    });
  };
}
