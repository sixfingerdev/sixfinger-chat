import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { HttpError, forbidden, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/**
 * Uzaktan CLI köprüsü. Cihaz (SixFinger Code CLI) dışarı doğru çalışır: `/link/sync` ile oturum özetlerini gönderir, bekleyen komutları alır.
 * Site/uygulama oturumları listeler, anlık görüntüyü okur, komut kuyruğa koyar. Cihaz çevrimdışıysa komut kabul edilmez (eski komut sonradan çalışmasın).
 * Erişim kuralı Code ile aynıdır (doğrulanmış, izinli üye).
 */

const ONLINE_SECONDS = 20;
const COMMAND_TTL_SECONDS = 120;
const SNAPSHOT_MAX_BYTES = 1_500_000;

const sessionIn = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(300).default(''),
  directory: z.string().max(500).default(''),
  status: z.enum(['idle', 'busy', 'waiting']).default('idle'),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  /** Yalnızca değiştiyse gönderilir. */
  snapshot: z.array(z.unknown()).max(200).optional(),
  pending: z.array(z.unknown()).max(20).optional(),
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.string().max(40).default(''),
  version: z.string().max(40).default(''),
});
const syncSchema = z.object({
  deviceId: z.string().uuid(),
  sessions: z.array(sessionIn).max(100).default([]),
  gone: z.array(z.string().max(100)).max(100).default([]),
});

const promptSchema = z.object({ text: z.string().trim().min(1).max(20_000) });
const permissionSchema = z.object({ requestId: z.string().min(1).max(100), reply: z.enum(['once', 'always', 'reject']) });
const questionSchema = z.object({ requestId: z.string().min(1).max(100), answers: z.array(z.array(z.string().max(2_000)).max(20)).max(20).optional(), reject: z.boolean().optional() });

export function linkRoutes(ctx: AppContext, guard: Guard) {
  const { db, code } = ctx;

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);
    app.addHook('preHandler', async (req) => {
      if (!code.isAllowed(req.user!)) throw forbidden('SixFinger Code için erişimin yok.');
    });

    async function ownDevice(userId: string, id: string) {
      const r = await db.query<{ id: string }>('select id from linked_devices where id = $1 and user_id = $2', [id, userId]);
      if (!r.rows[0]) throw notFound('Cihaz bulunamadı.');
      return r.rows[0];
    }

    // ---------- cihaz tarafı ----------

    app.post('/link/register', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
      const b = parse(registerSchema, req.body);
      const r = await db.query<{ id: string }>(
        `insert into linked_devices (user_id, name, platform, version) values ($1, $2, $3, $4)
         on conflict (user_id, name) do update set platform = excluded.platform, version = excluded.version, last_seen = now()
         returning id`,
        [req.user!.id, b.name, b.platform, b.version],
      );
      return { deviceId: r.rows[0]!.id };
    });

    app.post('/link/sync', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, bodyLimit: 8 * 1024 * 1024 }, async (req) => {
      const b = parse(syncSchema, req.body);
      await ownDevice(req.user!.id, b.deviceId);
      await db.query('update linked_devices set last_seen = now() where id = $1', [b.deviceId]);
      for (const s of b.sessions) {
        if (s.snapshot && Buffer.byteLength(JSON.stringify(s.snapshot)) > SNAPSHOT_MAX_BYTES) throw new HttpError(413, 'bad_request', 'Oturum özeti çok büyük.');
        await db.query(
          `insert into linked_sessions (device_id, remote_id, title, directory, status, updated_at, snapshot, pending)
           values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), coalesce($7::jsonb, '[]'::jsonb), coalesce($8::jsonb, '[]'::jsonb))
           on conflict (device_id, remote_id) do update set
             title = excluded.title, directory = excluded.directory, status = excluded.status, updated_at = excluded.updated_at,
             snapshot = case when $7::jsonb is null then linked_sessions.snapshot else excluded.snapshot end,
             pending = case when $8::jsonb is null then linked_sessions.pending else excluded.pending end`,
          [b.deviceId, s.id, s.title, s.directory, s.status, s.updatedAt ?? null, s.snapshot ? JSON.stringify(s.snapshot) : null, s.pending ? JSON.stringify(s.pending) : null],
        );
      }
      if (b.gone.length) await db.query('delete from linked_sessions where device_id = $1 and remote_id = any($2::text[])', [b.deviceId, b.gone]);
      await db.query(`update link_commands set status = 'expired' where device_id = $1 and status = 'pending' and created_at < now() - make_interval(secs => $2)`, [b.deviceId, COMMAND_TTL_SECONDS]);
      const cmds = await db.query<{ id: string; remote_id: string; kind: string; payload: unknown }>(
        `update link_commands set status = 'sent' where device_id = $1 and status = 'pending' returning id, remote_id, kind, payload`,
        [b.deviceId],
      );
      return { commands: cmds.rows.map((c) => ({ id: c.id, sessionId: c.remote_id, kind: c.kind, payload: c.payload })) };
    });

    // ---------- site / uygulama tarafı ----------

    app.get('/link/devices', async (req) => {
      const r = await db.query(
        `select d.id, d.name, d.platform, d.version, d.last_seen > now() - make_interval(secs => $2) as online,
                (select count(*)::int from linked_sessions s where s.device_id = d.id) as sessions
         from linked_devices d where d.user_id = $1 order by d.last_seen desc`,
        [req.user!.id, ONLINE_SECONDS],
      );
      return { devices: r.rows.map((d) => ({ id: d.id, name: d.name, platform: d.platform, version: d.version, online: d.online, sessions: d.sessions })) };
    });

    app.delete<{ Params: { id: string } }>('/link/devices/:id', async (req, reply) => {
      await ownDevice(req.user!.id, req.params.id);
      await db.query('delete from linked_devices where id = $1', [req.params.id]);
      return reply.code(204).send();
    });

    app.get('/link/sessions', async (req) => {
      const r = await db.query(
        `select s.device_id, d.name as device_name, s.remote_id, s.title, s.directory, s.status, s.updated_at,
                d.last_seen > now() - make_interval(secs => $2) as online
         from linked_sessions s join linked_devices d on d.id = s.device_id
         where d.user_id = $1 order by s.updated_at desc limit 200`,
        [req.user!.id, ONLINE_SECONDS],
      );
      return {
        sessions: r.rows.map((s) => ({ deviceId: s.device_id, deviceName: s.device_name, id: s.remote_id, title: s.title, directory: s.directory, status: s.status, updatedAt: s.updated_at, online: s.online })),
      };
    });

    app.get<{ Params: { deviceId: string; id: string } }>('/link/sessions/:deviceId/:id', async (req) => {
      await ownDevice(req.user!.id, req.params.deviceId);
      const r = await db.query(
        `select s.remote_id, s.title, s.directory, s.status, s.updated_at, s.snapshot, s.pending, d.name as device_name,
                d.last_seen > now() - make_interval(secs => $3) as online
         from linked_sessions s join linked_devices d on d.id = s.device_id where s.device_id = $1 and s.remote_id = $2`,
        [req.params.deviceId, req.params.id, ONLINE_SECONDS],
      );
      const s = r.rows[0];
      if (!s) throw notFound('Oturum bulunamadı.');
      return { session: { deviceId: req.params.deviceId, deviceName: s.device_name, id: s.remote_id, title: s.title, directory: s.directory, status: s.status, updatedAt: s.updated_at, online: s.online }, messages: s.snapshot, pending: s.pending };
    });

    async function enqueue(userId: string, deviceId: string, remoteId: string, kind: 'prompt' | 'abort' | 'permission' | 'question', payload: unknown) {
      await ownDevice(userId, deviceId);
      const online = await db.query<{ ok: boolean }>(`select last_seen > now() - make_interval(secs => $2) as ok from linked_devices where id = $1`, [deviceId, ONLINE_SECONDS]);
      if (!online.rows[0]?.ok) throw new HttpError(409, 'conflict', 'Cihaz çevrimdışı. CLI açık olmalı (`sixfinger link`).');
      const known = await db.query('select 1 from linked_sessions where device_id = $1 and remote_id = $2', [deviceId, remoteId]);
      if (!known.rows[0]) throw notFound('Oturum bulunamadı.');
      await db.query('insert into link_commands (device_id, remote_id, kind, payload) values ($1, $2, $3, $4::jsonb)', [deviceId, remoteId, kind, JSON.stringify(payload)]);
      return { ok: true };
    }

    type P = { Params: { deviceId: string; id: string } };
    app.post<P>('/link/sessions/:deviceId/:id/prompt', async (req) => enqueue(req.user!.id, req.params.deviceId, req.params.id, 'prompt', parse(promptSchema, req.body)));
    app.post<P>('/link/sessions/:deviceId/:id/abort', async (req) => enqueue(req.user!.id, req.params.deviceId, req.params.id, 'abort', {}));
    app.post<P>('/link/sessions/:deviceId/:id/permission', async (req) => enqueue(req.user!.id, req.params.deviceId, req.params.id, 'permission', parse(permissionSchema, req.body)));
    app.post<P>('/link/sessions/:deviceId/:id/question', async (req) => enqueue(req.user!.id, req.params.deviceId, req.params.id, 'question', parse(questionSchema, req.body)));
  };
}
