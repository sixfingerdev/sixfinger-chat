import type { FastifyInstance } from 'fastify';
import {
  createScheduledTaskSchema,
  parseRich,
  updateScheduledTaskSchema,
  type ArtifactListItemDTO,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { conflict, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/** Zamanlanmış görevler (kullanıcı yönetimi) ve Artifacts listesi. */
export function scheduleRoutes(ctx: AppContext, guard: Guard) {
  const { schedule, db } = ctx;

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);

    const member = (user: { isGuest: boolean }) => {
      if (user.isGuest) throw tierRestricted('Zamanlanmış görevler için hesap oluşturmalısın.');
    };

    app.get('/schedule', async (req) => {
      member(req.user!);
      return { tasks: await schedule.list(req.user!.id) };
    });

    app.post('/schedule', async (req, reply) => {
      member(req.user!);
      const body = parse(createScheduledTaskSchema, req.body);
      return reply.code(201).send({ task: await schedule.create(req.user!, body, 'user') });
    });

    app.patch<{ Params: { id: string } }>('/schedule/:id', async (req) => {
      member(req.user!);
      const body = parse(updateScheduledTaskSchema, req.body);
      return { task: await schedule.update(req.user!.id, req.params.id, body) };
    });

    app.delete<{ Params: { id: string } }>('/schedule/:id', async (req, reply) => {
      member(req.user!);
      await schedule.remove(req.user!.id, req.params.id);
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>('/schedule/:id/runs', async (req) => {
      member(req.user!);
      return { runs: await schedule.runs(req.user!.id, req.params.id) };
    });

    // Şimdi çalıştır: zamanlamayı değiştirmez; sonuç yeni bir sohbet olarak oluşur.
    app.post<{ Params: { id: string } }>('/schedule/:id/run', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      member(req.user!);
      const task = await schedule.loadOwned(req.user!.id, req.params.id);
      if (!ctx.runScheduled) throw conflict('Zamanlayıcı hazır değil.');
      await db.query('update scheduled_tasks set last_run_at = now(), run_count = run_count + 1 where id = $1', [task.id]);
      void ctx.runScheduled(task).catch((err) => ctx.log.error({ err, taskId: task.id }, 'görev elle çalıştırılamadı'));
      return reply.code(202).send({ ok: true });
    });

    // --- Artifacts: kullanıcının sohbetlerinde üretilmiş artifact'lar (her biri için en yeni sürüm) ---
    app.get<{ Querystring: { q?: string } }>('/artifacts', async (req) => {
      const user = req.user!;
      const rows = await db.query<{ id: string; chat_id: string; content: string; created_at: Date; title: string }>(
        `select m.id, m.chat_id, m.content, m.created_at, c.title
           from messages m join chats c on c.id = m.chat_id
          where c.user_id = $1 and c.kind = 'chat' and m.role = 'assistant' and m.status in ('complete', 'stopped') and m.content like '%<artifact%'
          order by m.created_at desc limit 400`,
        [user.id],
      );
      const seen = new Map<string, ArtifactListItemDTO>();
      // Yeniden eskiye: ilk görülen en yeni sürümdür; sonrakiler sürüm sayısını artırır.
      for (const m of rows.rows) {
        for (const seg of parseRich(m.content)) {
          if (seg.type !== 'artifact' || !seg.closed) continue;
          const key = `${m.chat_id}:${seg.id}`;
          const cur = seen.get(key);
          if (cur) cur.versions += 1;
          else seen.set(key, { chatId: m.chat_id, chatTitle: m.title, messageId: m.id, artifactId: seg.id, title: seg.title || seg.id, kind: seg.kind, versions: 1, updatedAt: m.created_at.toISOString() });
        }
      }
      const q = (req.query.q ?? '').trim().toLowerCase();
      const items = [...seen.values()].filter((a) => !q || `${a.title} ${a.chatTitle}`.toLowerCase().includes(q));
      return { artifacts: items };
    });
  };
}
