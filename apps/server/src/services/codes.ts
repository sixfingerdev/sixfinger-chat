import type { Db } from '../db/pool.ts';
import type { Config } from '../config.ts';
import { randomCode, sha256 } from '../lib/crypto.ts';
import { HttpError } from '../lib/errors.ts';

const TTL_MIN = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 45;

export type CodePurpose = 'verify' | 'reset';

export function createCodes(db: Db, config: Config) {
  const hashCode = (email: string, purpose: CodePurpose, code: string) =>
    sha256(`${config.JWT_SECRET}:${purpose}:${email.toLowerCase()}:${code}`);

  /** Yeni kod üretir. Çok sık istenirse 429 döner. */
  async function create(userId: string | null, email: string, purpose: CodePurpose): Promise<string> {
    const last = await db.query<{ age: number }>(
      `select extract(epoch from now() - created_at)::int as age from email_codes
        where lower(email) = lower($1) and purpose = $2 order by created_at desc limit 1`,
      [email, purpose],
    );
    const age = last.rows[0]?.age;
    if (age !== undefined && age < RESEND_COOLDOWN_S) {
      throw new HttpError(429, 'rate_limited', `Yeni kod için ${RESEND_COOLDOWN_S - age} sn bekle.`, {
        retryAfter: RESEND_COOLDOWN_S - age,
      });
    }
    const code = randomCode();
    // Eski kullanılmamış kodları geçersiz kıl.
    await db.query(
      `update email_codes set consumed_at = now()
        where lower(email) = lower($1) and purpose = $2 and consumed_at is null`,
      [email, purpose],
    );
    await db.query(
      `insert into email_codes (user_id, email, purpose, code_hash, expires_at)
       values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
      [userId, email, purpose, hashCode(email, purpose, code), String(TTL_MIN)],
    );
    return code;
  }

  /** Kodu doğrular ve tüketir. Başarısızsa invalid_code fırlatır. */
  async function consume(email: string, purpose: CodePurpose, code: string): Promise<void> {
    const r = await db.query<{ id: string; code_hash: string; attempts: number }>(
      `select id, code_hash, attempts from email_codes
        where lower(email) = lower($1) and purpose = $2 and consumed_at is null and expires_at > now()
        order by created_at desc limit 1`,
      [email, purpose],
    );
    const row = r.rows[0];
    const invalid = () => new HttpError(400, 'invalid_code', 'Kod geçersiz ya da süresi dolmuş.');
    if (!row || row.attempts >= MAX_ATTEMPTS) throw invalid();
    if (row.code_hash !== hashCode(email, purpose, code)) {
      await db.query('update email_codes set attempts = attempts + 1 where id = $1', [row.id]);
      throw invalid();
    }
    await db.query('update email_codes set consumed_at = now() where id = $1', [row.id]);
  }

  return { create, consume };
}
export type Codes = ReturnType<typeof createCodes>;
