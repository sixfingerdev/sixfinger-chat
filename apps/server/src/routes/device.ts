import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { HttpError, notFound, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/**
 * Cihaz girişi (SixFinger Code CLI): CLI `start` ile bir kod alır ve tarayıcıyı açar; kullanıcı oturum açmış sitede kodu onaylar;
 * CLI `poll` ile jetonları alır. Parola/jeton elle girilmez. Kodlar 10 dakika geçerli ve tek kullanımlıktır.
 */

const TTL_SECONDS = 600;
const INTERVAL_SECONDS = 2;
/** Karıştırılan harfler (0/O, 1/I) yok; kullanıcı koda bakıp doğrulayabilsin. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const startSchema = z.object({ client: z.string().trim().min(1).max(60).optional() });
const pollSchema = z.object({ deviceCode: z.string().min(10).max(100) });
const codeSchema = z.object({ userCode: z.string().trim().min(8).max(12) });

const clientOf = (req: FastifyRequest) => ({
  userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  ip: req.ip ?? null,
});

function newUserCode(): string {
  let s = '';
  for (const b of randomToken(16).split('')) {
    if (s.length === 8) break;
    s += ALPHABET[b.charCodeAt(0) % ALPHABET.length];
  }
  while (s.length < 8) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normalize = (c: string) => {
  const s = c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
};

export function deviceRoutes(ctx: AppContext, guard: Guard) {
  const { db, sessions, config } = ctx;
  const webUrl = config.PUBLIC_WEB_URL.replace(/\/$/, '');

  return async function (app: FastifyInstance) {
    app.post('/device/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const { client } = parse(startSchema, req.body ?? {});
      await db.query('delete from device_auth where expires_at < now() - interval \'1 hour\'');
      const deviceCode = `sfd_${randomToken(32)}`;
      for (let i = 0; i < 5; i++) {
        const userCode = newUserCode();
        try {
          await db.query(
            `insert into device_auth (device_hash, user_code, client, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))`,
            [sha256(deviceCode), userCode, client ?? 'SixFinger Code', TTL_SECONDS],
          );
          return { deviceCode, userCode, verificationUrl: `${webUrl}/device?code=${userCode}`, interval: INTERVAL_SECONDS, expiresIn: TTL_SECONDS };
        } catch (e) {
          if ((e as { code?: string }).code !== '23505') throw e; // kod çakıştı: yeniden dene
        }
      }
      throw new HttpError(503, 'upstream_unavailable', 'Kod üretilemedi, tekrar dene.');
    });

    app.post('/device/poll', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { deviceCode } = parse(pollSchema, req.body);
      // Onaylanmışsa kaydı tek seferde tüketir: aynı kodla ikinci kez jeton alınamaz.
      const done = await db.query<{ user_id: string }>(
        `update device_auth set status = 'consumed' where device_hash = $1 and status = 'approved' and expires_at > now() returning user_id`,
        [sha256(deviceCode)],
      );
      if (done.rows[0]) return { status: 'approved', ...(await sessions.issue(done.rows[0].user_id, clientOf(req))) };
      const row = await db.query<{ status: string; expired: boolean }>(`select status, expires_at <= now() as expired from device_auth where device_hash = $1`, [sha256(deviceCode)]);
      const r = row.rows[0];
      if (!r || r.expired || r.status === 'consumed') return reply.code(410).send({ error: { code: 'expired', message: 'Kodun süresi doldu. Yeniden başlat.' } });
      return { status: 'pending' };
    });

    await app.register(async (authed) => {
      authed.addHook('preHandler', guard.requireUser);

      /** Onay sayfası için: bu kod hangi istemciye ait? */
      authed.post('/device/info', async (req) => {
        const userCode = normalize(parse(codeSchema, req.body).userCode);
        const r = await db.query<{ client: string; status: string }>(`select client, status from device_auth where user_code = $1 and expires_at > now()`, [userCode]);
        if (!r.rows[0] || r.rows[0].status !== 'pending') throw notFound('Kod bulunamadı ya da süresi doldu.');
        return { client: r.rows[0].client };
      });

      authed.post('/device/approve', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        if (req.user!.isGuest) throw tierRestricted('Cihaz bağlamak için hesap oluşturmalısın.');
        const userCode = normalize(parse(codeSchema, req.body).userCode);
        const r = await db.query(`update device_auth set status = 'approved', user_id = $2 where user_code = $1 and status = 'pending' and expires_at > now()`, [userCode, req.user!.id]);
        if (r.rowCount === 0) throw notFound('Kod bulunamadı ya da süresi doldu.');
        return { ok: true };
      });
    });
  };
}
