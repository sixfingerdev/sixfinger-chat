import type { AuthResponse, SessionDTO } from '@sixfinger/shared';
import type { Config } from '../config.ts';
import type { Db, Queryable } from '../db/pool.ts';
import type { Jwt } from '../lib/jwt.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { unauthorized } from '../lib/errors.ts';
import { findUserById, toUserDTO } from './users.ts';

export interface ClientInfo {
  userAgent: string | null;
  ip: string | null;
}

export function createSessions(db: Db, config: Config, jwt: Jwt) {
  const refreshTtlMs = config.REFRESH_TOKEN_TTL_DAYS * 86_400_000;

  async function issue(userId: string, client: ClientInfo, sessionId?: string): Promise<AuthResponse> {
    const refreshToken = `sfr_${randomToken(32)}`;
    const hash = sha256(refreshToken);
    const expires = new Date(Date.now() + refreshTtlMs);
    let sid = sessionId;
    if (sid) {
      await db.query(
        `update refresh_tokens
            set prev_hash = token_hash, prev_valid_until = now() + interval '30 seconds',
                token_hash = $2, last_used_at = now(), expires_at = $3
          where id = $1`,
        [sid, hash, expires],
      );
    } else {
      const r = await db.query<{ id: string }>(
        `insert into refresh_tokens (user_id, token_hash, user_agent, ip, expires_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [userId, hash, client.userAgent?.slice(0, 300) ?? null, client.ip, expires],
      );
      sid = r.rows[0]!.id;
    }
    const user = await findUserById(db, userId);
    if (!user) throw unauthorized();
    return {
      user: toUserDTO(user),
      accessToken: await jwt.sign({ sub: userId, sid }),
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async function refresh(token: string, client: ClientInfo): Promise<AuthResponse> {
    const hash = sha256(token);
    const r = await db.query<{
      id: string;
      user_id: string;
      token_hash: string;
      prev_hash: string | null;
      prev_valid_until: Date | null;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `select id, user_id, token_hash, prev_hash, prev_valid_until, expires_at, revoked_at
         from refresh_tokens where token_hash = $1 or prev_hash = $1`,
      [hash],
    );
    const row = r.rows[0];
    if (!row || row.revoked_at || row.expires_at < new Date()) throw unauthorized('Oturum süresi doldu.');
    if (row.token_hash !== hash) {
      // Eski token: sadece kısa süreli tolerans (iki sekmenin aynı anda yenilemesi).
      const ok = row.prev_hash === hash && row.prev_valid_until && row.prev_valid_until.getTime() > Date.now();
      if (!ok) {
        // Çalınmış token yeniden kullanımı olabilir → oturumu kapat.
        await db.query('update refresh_tokens set revoked_at = now() where id = $1', [row.id]);
        throw unauthorized('Oturum süresi doldu.');
      }
    }
    return issue(row.user_id, client, row.id);
  }

  async function revoke(token: string): Promise<void> {
    await db.query('update refresh_tokens set revoked_at = now() where token_hash = $1', [sha256(token)]);
  }

  async function revokeAllForUser(q: Queryable, userId: string, exceptSessionId?: string): Promise<void> {
    await q.query(
      `update refresh_tokens set revoked_at = now()
        where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)`,
      [userId, exceptSessionId ?? null],
    );
  }

  async function isActive(sessionId: string, userId: string): Promise<boolean> {
    const r = await db.query(
      `select 1 from refresh_tokens where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`,
      [sessionId, userId],
    );
    return r.rowCount === 1;
  }

  async function list(userId: string, currentSessionId: string): Promise<SessionDTO[]> {
    const r = await db.query<{
      id: string;
      user_agent: string | null;
      ip: string | null;
      created_at: Date;
      last_used_at: Date;
    }>(
      `select id, user_agent, ip, created_at, last_used_at from refresh_tokens
        where user_id = $1 and revoked_at is null and expires_at > now()
        order by last_used_at desc`,
      [userId],
    );
    return r.rows.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      ip: s.ip,
      createdAt: s.created_at.toISOString(),
      lastUsedAt: s.last_used_at.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async function revokeOne(userId: string, sessionId: string): Promise<boolean> {
    const r = await db.query(
      'update refresh_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null',
      [sessionId, userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  return { issue, refresh, revoke, revokeAllForUser, isActive, list, revokeOne };
}
export type Sessions = ReturnType<typeof createSessions>;
