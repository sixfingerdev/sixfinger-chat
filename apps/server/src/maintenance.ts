import { GUEST_RETENTION_DAYS } from '@sixfinger/shared';
import type { AppContext } from './context.ts';

/** Takılı kalmış akışları kapatır, eski misafirleri ve boş sohbetleri temizler. */
export async function runMaintenance(ctx: AppContext): Promise<void> {
  const { db, log } = ctx;
  const stuck = await db.query(
    `update messages set status = 'error' where status = 'streaming' and created_at < now() - interval '5 minutes'`,
  );
  const guests = await db.query(
    `delete from users where is_guest and last_seen_at < now() - ($1 || ' days')::interval`,
    [String(GUEST_RETENTION_DAYS)],
  );
  const empty = await db.query(
    `delete from chats where last_message_at is null and created_at < now() - interval '1 day'`,
  );
  await db.query(`delete from email_codes where expires_at < now() - interval '1 day'`);
  await db.query(`delete from refresh_tokens where expires_at < now() or revoked_at < now() - interval '7 days'`);
  await db.query(`delete from usage_daily where day < current_date - 7`);
  await db.query(`delete from usage_ip where day < current_date - 7`);
  log.info(
    { stuckStreams: stuck.rowCount, guestsDeleted: guests.rowCount, emptyChats: empty.rowCount },
    'bakım tamamlandı',
  );
}
