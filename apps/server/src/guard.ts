import type { FastifyRequest } from 'fastify';
import { TIER_LIMITS } from '@sixfinger/shared';
import type { AppContext } from './context.ts';
import type { AuthUser } from './lib/types.ts';
import { unauthorized } from './lib/errors.ts';
import { tierOf, type UserRow } from './services/users.ts';

const seenAt = new Map<string, number>();

/** Authorization başlığındaki erişim token'ını çözüp kullanıcıyı yükler. Geçersizse null. */
export function createGuard(ctx: AppContext) {
  async function resolve(req: FastifyRequest): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const claims = await ctx.jwt.verify(header.slice(7));
    if (!claims) return null;
    const r = await ctx.db.query<UserRow>(
      `select u.id, u.email, u.is_guest, u.email_verified_at, u.locale
         from refresh_tokens t join users u on u.id = t.user_id
        where t.id = $1 and t.user_id = $2 and t.revoked_at is null and t.expires_at > now()`,
      [claims.sid, claims.sub],
    );
    const row = r.rows[0];
    if (!row) return null;
    const tier = tierOf(row);
    // last_seen_at'i dakikada bir güncelle (misafir temizliği için).
    const now = Date.now();
    if ((seenAt.get(row.id) ?? 0) < now - 60_000) {
      seenAt.set(row.id, now);
      if (seenAt.size > 5_000) seenAt.clear();
      void ctx.db.query('update users set last_seen_at = now() where id = $1', [row.id]).catch(() => {});
    }
    return {
      id: row.id,
      email: row.email,
      isGuest: row.is_guest,
      emailVerified: Boolean(row.email_verified_at),
      tier,
      limits: TIER_LIMITS[tier],
      locale: row.locale,
      sessionId: claims.sid,
    };
  }

  /** preHandler: oturum zorunlu. */
  async function requireUser(req: FastifyRequest): Promise<void> {
    const u = await resolve(req);
    if (!u) throw unauthorized();
    req.user = u;
  }

  /** preHandler: oturum opsiyonel. */
  async function optionalUser(req: FastifyRequest): Promise<void> {
    req.user = await resolve(req);
  }

  return { requireUser, optionalUser };
}
export type Guard = ReturnType<typeof createGuard>;
