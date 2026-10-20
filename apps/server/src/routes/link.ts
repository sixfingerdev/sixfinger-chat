import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/**
 * Uzaktan kontrol (RC) köprüsü. Cihaz (SixFinger Code CLI) dışarı doğru çalışır:
 *  - `/link/sync`: oturum özetlerini gönderir (anlık görüntü yalnızca değiştiyse), onayları (ack) iletir.
 *  - `/link/poll`: komutları uzun yoklamayla bekler (komut gelince hemen döner); aynı zamanda canlılık sinyalidir.
 * Site/uygulama oturumları listeler, canlı akışı (SSE) izler, komut gönderir. Komut = {tür, yük}: sunucu türü/yükü yorumlamaz,
 * böylece CLI'da sunucuda olmayan araç ve komutlar da çalışır; desteklenmeyen komutu cihaz "failed" diye onaylar.
 * Teslim: komut gönderilince 'sent' olur, cihaz onaylayana (done/failed) dek 10 sn'de bir, en çok 3 kez yeniden gönderilir (cihaz kimliğe göre tekilleştirir).
 * Cihaz çevrimdışıysa komut kabul edilmez; 2 dakikadan eski komut çalıştırılmaz.
 */

const PROTOCOL = 1;
const MIN_PROTOCOL = 1;
const ONLINE_SECONDS = 35;
const COMMAND_TTL_SECONDS = 120;
const REDELIVER_SECONDS = 10;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_SECONDS = 20;
const SNAPSHOT_MAX_BYTES = 1_500_000;
const PAYLOAD_MAX_BYTES = 64_000;

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

const ackIn = z.object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(500).optional(), result: z.unknown().optional() });

const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.string().max(40).default(''),
  version: z.string().max(40).default(''),
  protocol: z.number().int().min(0).max(1000).default(1),
  capabilities: z.array(z.string().max(40)).max(40).default([]),
});
const syncSchema = z.object({
  deviceId: z.string().uuid(),
  sessions: z.array(sessionIn).max(100).default([]),
  gone: z.array(z.string().max(100)).max(100).default([]),
  acks: z.array(ackIn).max(100).default([]),
});
const pollSchema = z.object({ deviceId: z.string().uuid(), acks: z.array(ackIn).max(100).default([]), wait: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(0) });

const kindSchema = z.string().regex(/^[a-z][a-z0-9_.]{0,39}$/);
const commandSchema = z.object({ kind: kindSchema, sessionId: z.string().max(100).optional(), payload: z.record(z.unknown()).default({}) });
const promptSchema = z.object({ text: z.string().trim().min(1).max(20_000), model: z.enum(['fast', 'deep']).optional() });
const permissionSchema = z.object({ requestId: z.string().min(1).max(100), reply: z.enum(['once', 'always', 'reject']) });
const questionSchema = z.object({ requestId: z.string().min(1).max(100), answers: z.array(z.array(z.string().max(2_000)).max(20)).max(20).optional(), reject: z.boolean().optional() });

export function linkRoutes(ctx: AppContext, guard: Guard) {
  const { db, code } = ctx;
  /** Tek süreçli uyandırma kanalı (Pi'de tek sunucu): komut geldi / oturum değişti. */
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

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

    async function applyAcks(deviceId: string, acks: z.infer<typeof ackIn>[]) {
      for (const a of acks) {
        await db.query(
          `update link_commands set status = $3, result = $4::jsonb where id = $1 and device_id = $2 and status in ('sent', 'pending')`,
          [a.id, deviceId, a.ok ? 'done' : 'failed', JSON.stringify({ ...(a.error ? { error: a.error } : {}), ...(a.result !== undefined ? { result: a.result } : {}) })],
        );
      }
    }

    /** Teslim edilecek komutlar: yeni olanlar + onaylanmamış (10 sn'den eski, <3 deneme). Süresi dolanlar kapatılır. */
    async function deliverable(deviceId: string) {
      await db.query(`update link_commands set status = 'expired' where device_id = $1 and status = 'pending' and created_at < now() - make_interval(secs => $2)`, [deviceId, COMMAND_TTL_SECONDS]);
      await db.query(
        `update link_commands set status = 'failed', result = '{"error":"cihaz onaylamadı"}'::jsonb
         where device_id = $1 and status = 'sent' and attempts >= $2 and sent_at < now() - make_interval(secs => $3)`,
        [deviceId, MAX_ATTEMPTS, REDELIVER_SECONDS],
      );
      const r = await db.query<{ id: string; remote_id: string; kind: string; payload: unknown; attempts: number; created_at: Date }>(
        `update link_commands set status = 'sent', sent_at = now(), attempts = attempts + 1
         where id in (
           select id from link_commands
           where device_id = $1 and created_at > now() - make_interval(secs => $2)
             and (status = 'pending' or (status = 'sent' and sent_at < now() - make_interval(secs => $3) and attempts < $4))
           order by created_at limit 50 for update skip locked)
         returning id, remote_id, kind, payload, attempts, created_at`,
        [deviceId, COMMAND_TTL_SECONDS, REDELIVER_SECONDS, MAX_ATTEMPTS],
      );
      // UPDATE ... RETURNING sırayı garanti etmez: komutlar gönderildikleri sırayla teslim edilir.
      return r.rows
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((c) => ({ id: c.id, sessionId: c.remote_id, kind: c.kind, payload: c.payload, attempt: c.attempts }));
    }

    const touch = (deviceId: string) => db.query('update linked_devices set last_seen = now() where id = $1', [deviceId]);

    // ---------- cihaz tarafı ----------

    app.post('/link/register', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
      const b = parse(registerSchema, req.body);
      if (b.protocol < MIN_PROTOCOL) throw new HttpError(426, 'bad_request', 'CLI sürümün eski. Güncelle: sixfinger upgrade');
      const r = await db.query<{ id: string }>(
        `insert into linked_devices (user_id, name, platform, version, protocol, capabilities) values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (user_id, name) do update set platform = excluded.platform, version = excluded.version, protocol = excluded.protocol, capabilities = excluded.capabilities, last_seen = now()
         returning id`,
        [req.user!.id, b.name, b.platform, b.version, b.protocol, JSON.stringify(b.capabilities)],
      );
      return { deviceId: r.rows[0]!.id, protocol: PROTOCOL, serverTime: new Date().toISOString() };
    });

    app.post('/link/sync', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } }, bodyLimit: 8 * 1024 * 1024 }, async (req) => {
      const b = parse(syncSchema, req.body);
      await ownDevice(req.user!.id, b.deviceId);
      await touch(b.deviceId);
      await applyAcks(b.deviceId, b.acks);
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
        bus.emit(`session:${b.deviceId}:${s.id}`);
      }
      if (b.gone.length) await db.query('delete from linked_sessions where device_id = $1 and remote_id = any($2::text[])', [b.deviceId, b.gone]);
      if (b.acks.length) for (const a of b.acks) bus.emit(`ack:${a.id}`);
      return { commands: await deliverable(b.deviceId), serverTime: new Date().toISOString() };
    });

    /** Uzun yoklama: komut gelene ya da `wait` saniye dolana dek bekler. Cihazın canlılık sinyalidir. */
    app.post('/link/poll', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req) => {
      const b = parse(pollSchema, req.body);
      await ownDevice(req.user!.id, b.deviceId);
      await touch(b.deviceId);
      await applyAcks(b.deviceId, b.acks);
      let commands = await deliverable(b.deviceId);
      if (commands.length === 0 && b.wait > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            bus.off(`device:${b.deviceId}`, done);
            req.raw.off('close', done);
            resolve();
          };
          const timer = setTimeout(done, b.wait * 1000);
          bus.on(`device:${b.deviceId}`, done);
          req.raw.once('close', done);
        });
        if (!req.raw.destroyed) {
          await touch(b.deviceId);
          commands = await deliverable(b.deviceId);
        }
      }
      return { commands, serverTime: new Date().toISOString() };
    });

    // ---------- site / uygulama tarafı ----------

    app.get('/link/devices', async (req) => {
      const r = await db.query(
        `select d.id, d.name, d.platform, d.version, d.protocol, d.capabilities, d.last_seen > now() - make_interval(secs => $2) as online,
                (select count(*)::int from linked_sessions s where s.device_id = d.id) as sessions
         from linked_devices d where d.user_id = $1 order by d.last_seen desc`,
        [req.user!.id, ONLINE_SECONDS],
      );
      return { devices: r.rows.map((d) => ({ id: d.id, name: d.name, platform: d.platform, version: d.version, protocol: d.protocol, capabilities: d.capabilities, online: d.online, sessions: d.sessions })) };
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

    async function detail(userId: string, deviceId: string, id: string) {
      await ownDevice(userId, deviceId);
      const r = await db.query(
        `select s.remote_id, s.title, s.directory, s.status, s.updated_at, s.snapshot, s.pending, d.name as device_name,
                d.last_seen > now() - make_interval(secs => $3) as online
         from linked_sessions s join linked_devices d on d.id = s.device_id where s.device_id = $1 and s.remote_id = $2`,
        [deviceId, id, ONLINE_SECONDS],
      );
      const s = r.rows[0];
      if (!s) throw notFound('Oturum bulunamadı.');
      const cmds = await db.query(
        `select id, kind, status, result->>'error' as error, created_at from link_commands where device_id = $1 and remote_id = $2 order by created_at desc limit 10`,
        [deviceId, id],
      );
      return {
        session: { deviceId, deviceName: s.device_name, id: s.remote_id, title: s.title, directory: s.directory, status: s.status, updatedAt: s.updated_at, online: s.online },
        messages: s.snapshot,
        pending: s.pending,
        commands: cmds.rows.map((c) => ({ id: c.id, kind: c.kind, status: c.status, error: c.error, createdAt: c.created_at })),
      };
    }

    type P = { Params: { deviceId: string; id: string } };
    app.get<P>('/link/sessions/:deviceId/:id', async (req) => detail(req.user!.id, req.params.deviceId, req.params.id));

    /** Canlı akış (SSE): oturum her değiştiğinde (ve komut durumu değiştiğinde) tam ayrıntı gönderilir; 15 sn'de bir ping. */
    app.get<P>('/link/sessions/:deviceId/:id/stream', async (req, reply) => {
      const { deviceId, id } = req.params;
      const userId = req.user!.id;
      const first = await detail(userId, deviceId, id);
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const send = (o: unknown) => reply.raw.write(`event: session\ndata: ${JSON.stringify(o)}\n\n`);
      send(first);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      const push = () => {
        if (timer || closed) return;
        timer = setTimeout(async () => {
          timer = undefined;
          try {
            if (!closed) send(await detail(userId, deviceId, id));
          } catch {
            /* oturum silindi: akış açık kalır, ping sürer */
          }
        }, 120);
      };
      const key = `session:${deviceId}:${id}`;
      bus.on(key, push);
      bus.on(`cmd:${deviceId}`, push);
      const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
      req.raw.on('close', () => {
        closed = true;
        clearInterval(ping);
        if (timer) clearTimeout(timer);
        bus.off(key, push);
        bus.off(`cmd:${deviceId}`, push);
      });
    });

    app.get<{ Params: { id: string } }>('/link/commands/:id', async (req) => {
      const r = await db.query(
        `select c.id, c.kind, c.status, c.result, c.created_at from link_commands c join linked_devices d on d.id = c.device_id where c.id = $1 and d.user_id = $2`,
        [req.params.id, req.user!.id],
      );
      if (!r.rows[0]) throw notFound('Komut bulunamadı.');
      const c = r.rows[0];
      return { id: c.id, kind: c.kind, status: c.status, result: c.result, createdAt: c.created_at };
    });

    async function enqueue(req: { user: { id: string } | null; headers: Record<string, unknown> }, deviceId: string, remoteId: string, kind: string, payload: unknown, needSession = true) {
      const userId = req.user!.id;
      await ownDevice(userId, deviceId);
      const online = await db.query<{ ok: boolean }>(`select last_seen > now() - make_interval(secs => $2) as ok from linked_devices where id = $1`, [deviceId, ONLINE_SECONDS]);
      if (!online.rows[0]?.ok) throw new HttpError(409, 'conflict', 'Cihaz çevrimdışı. CLI açık olmalı (`sixfinger link`).');
      if (needSession) {
        const known = await db.query('select 1 from linked_sessions where device_id = $1 and remote_id = $2', [deviceId, remoteId]);
        if (!known.rows[0]) throw notFound('Oturum bulunamadı.');
      }
      const json = JSON.stringify(payload ?? {});
      if (Buffer.byteLength(json) > PAYLOAD_MAX_BYTES) throw badRequest('Komut yükü çok büyük.');
      const idemRaw = req.headers['x-idempotency-key'];
      const idem = typeof idemRaw === 'string' && idemRaw.length > 0 && idemRaw.length <= 64 ? idemRaw : null;
      const r = await db.query<{ id: string }>(
        `insert into link_commands (device_id, remote_id, kind, payload, idem) values ($1, $2, $3, $4::jsonb, $5)
         on conflict (device_id, idem) where idem is not null do update set idem = excluded.idem returning id`,
        [deviceId, remoteId, kind, json, idem],
      );
      bus.emit(`device:${deviceId}`);
      bus.emit(`cmd:${deviceId}`);
      return { ok: true, commandId: r.rows[0]!.id };
    }

    app.post<P>('/link/sessions/:deviceId/:id/prompt', async (req) => enqueue(req, req.params.deviceId, req.params.id, 'prompt', parse(promptSchema, req.body)));
    app.post<P>('/link/sessions/:deviceId/:id/abort', async (req) => enqueue(req, req.params.deviceId, req.params.id, 'abort', {}));
    app.post<P>('/link/sessions/:deviceId/:id/permission', async (req) => enqueue(req, req.params.deviceId, req.params.id, 'permission', parse(permissionSchema, req.body)));
    app.post<P>('/link/sessions/:deviceId/:id/question', async (req) => enqueue(req, req.params.deviceId, req.params.id, 'question', parse(questionSchema, req.body)));

    /** Genel komut: sunucunun tanımadığı türler dahil (ör. `new_session`, CLI'ya özgü komutlar). Cihaz desteklemiyorsa "failed" onaylar. */
    app.post<{ Params: { deviceId: string } }>('/link/devices/:deviceId/commands', async (req) => {
      const b = parse(commandSchema, req.body);
      return enqueue(req, req.params.deviceId, b.sessionId ?? '', b.kind, b.payload, Boolean(b.sessionId));
    });
  };
}
