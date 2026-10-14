import type { Tier, UsageDTO } from '@sixfinger/shared';
import { TIER_LIMITS } from '@sixfinger/shared';
import type { Db } from '../db/pool.ts';
import { HttpError } from '../lib/errors.ts';

const TZ = 'Europe/Istanbul';
/** Misafir hesap farmına karşı: aynı IP'den günlük toplam misafir mesajı. */
const GUEST_IP_DAILY = 60;

export function createUsage(db: Db) {
  async function day(): Promise<{ day: string; resetsAt: Date }> {
    const r = await db.query<{ day: string; resets_at: Date }>(
      `select (now() at time zone '${TZ}')::date as day,
              (((now() at time zone '${TZ}')::date + 1)::timestamp at time zone '${TZ}') as resets_at`,
    );
    return { day: r.rows[0]!.day, resetsAt: r.rows[0]!.resets_at };
  }

  async function get(userId: string, tier: Tier): Promise<UsageDTO> {
    const d = await day();
    const r = await db.query<{ messages: number }>(
      'select messages from usage_daily where user_id = $1 and day = $2',
      [userId, d.day],
    );
    return {
      tier,
      used: r.rows[0]?.messages ?? 0,
      limit: TIER_LIMITS[tier].dailyMessages,
      resetsAt: d.resetsAt.toISOString(),
    };
  }

  /** Bir mesaj hakkı tüketir. Limit aşılırsa 429 fırlatır. */
  async function consume(userId: string, tier: Tier, ip: string | null): Promise<void> {
    const d = await day();
    const limit = TIER_LIMITS[tier].dailyMessages;
    const r = await db.query(
      `insert into usage_daily (user_id, day, messages) values ($1, $2, 1)
       on conflict (user_id, day) do update set messages = usage_daily.messages + 1
         where usage_daily.messages < $3
       returning messages`,
      [userId, d.day, limit],
    );
    if (r.rowCount === 0) {
      throw new HttpError(
        429,
        'quota_exceeded',
        tier === 'guest'
          ? 'Misafir günlük mesaj hakkın doldu. Hesap oluşturarak daha fazlasına eriş.'
          : 'Günlük mesaj hakkın doldu. Yarın yenilenecek.',
        { resetsAt: d.resetsAt.toISOString(), limit, tier },
      );
    }
    if (tier === 'guest' && ip) {
      const ipr = await db.query(
        `insert into usage_ip (ip, day, messages) values ($1, $2, 1)
         on conflict (ip, day) do update set messages = usage_ip.messages + 1
           where usage_ip.messages < $3
         returning messages`,
        [ip, d.day, GUEST_IP_DAILY],
      );
      if (ipr.rowCount === 0) {
        await refund(userId);
        throw new HttpError(
          429,
          'quota_exceeded',
          'Bu ağdan çok fazla misafir isteği geldi. Hesap oluşturarak devam edebilirsin.',
          { resetsAt: d.resetsAt.toISOString(), limit, tier },
        );
      }
    }
  }

  /** Yanıt hiç üretilemediyse hakkı geri ver. */
  async function refund(userId: string, ip?: string | null): Promise<void> {
    const d = await day();
    await db.query(
      'update usage_daily set messages = greatest(messages - 1, 0) where user_id = $1 and day = $2',
      [userId, d.day],
    );
    if (ip) {
      await db.query('update usage_ip set messages = greatest(messages - 1, 0) where ip = $1 and day = $2', [
        ip,
        d.day,
      ]);
    }
  }

  return { get, consume, refund };
}
export type Usage = ReturnType<typeof createUsage>;
