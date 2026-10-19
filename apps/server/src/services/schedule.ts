import type { FastifyBaseLogger } from 'fastify';
import {
  DEFAULT_TIMEZONE,
  SCHEDULE_LIMITS,
  computeNextRun,
  createScheduledTaskSchema,
  describeSchedule,
  scheduleSpecSchema,
  updateScheduledTaskSchema,
  type ChatMode,
  type CreateScheduledTaskInput,
  type ScheduleSpec,
  type ScheduledRunDTO,
  type ScheduledTaskDTO,
  type UpdateScheduledTaskInput,
} from '@sixfinger/shared';
import { TIER_LIMITS } from '@sixfinger/shared';
import type { Db } from '../db/pool.ts';
import { conflict, notFound } from '../lib/errors.ts';
import type { AuthUser } from '../lib/types.ts';
import { ToolError } from './tools/errors.ts';
import type { ToolDef } from './tools/types.ts';
import { tierOf, type UserRow } from './users.ts';

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  mode: ChatMode;
  schedule: ScheduleSpec;
  timezone: string;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_chat_id: string | null;
  last_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
  run_count: number;
  source: 'user' | 'agent';
  created_at: Date;
}

export const toTaskDTO = (r: TaskRow): ScheduledTaskDTO => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  mode: r.mode,
  schedule: r.schedule,
  timezone: r.timezone,
  enabled: r.enabled,
  nextRunAt: r.enabled ? (r.next_run_at?.toISOString() ?? null) : null,
  lastRunAt: r.last_run_at?.toISOString() ?? null,
  lastChatId: r.last_chat_id,
  lastStatus: r.last_status,
  lastError: r.last_error,
  runCount: r.run_count,
  source: r.source,
  createdAt: r.created_at.toISOString(),
});

export type ScheduledTask = TaskRow;

export interface Schedule {
  list(userId: string): Promise<ScheduledTaskDTO[]>;
  get(userId: string, id: string): Promise<ScheduledTaskDTO>;
  create(user: AuthUser, input: CreateScheduledTaskInput, source: 'user' | 'agent'): Promise<ScheduledTaskDTO>;
  update(userId: string, id: string, patch: UpdateScheduledTaskInput): Promise<ScheduledTaskDTO>;
  remove(userId: string, id: string): Promise<void>;
  runs(userId: string, id: string, limit?: number): Promise<ScheduledRunDTO[]>;
  /** Şimdi çalıştır: sıradaki zamanı etkilemeden satırı döner. */
  loadOwned(userId: string, id: string): Promise<TaskRow>;
  /** Zamanı gelmiş görevleri alıp bir sonraki zamanı ilerletir (ya da tek seferliyse kapatır). */
  claimDue(limit: number): Promise<TaskRow[]>;
  recordRun(id: string, r: { chatId: string | null; status: 'ok' | 'error' | 'skipped'; error?: string | null }): Promise<void>;
  /** Kullanıcı satırından AuthUser (sunucu tarafında, istek olmadan). */
  authUser(userId: string): Promise<AuthUser | null>;
  tools(): ToolDef[];
}

/** Bir tek seferlik görev bu kadar geç kaldıysa (sunucu kapalıydı) çalıştırılmaz. */
const MISSED_ONCE_MS = 6 * 3_600_000;

export function createSchedule(db: Db): Schedule {
  const one = async (userId: string, id: string): Promise<TaskRow> => {
    const r = await db.query<TaskRow>('select * from scheduled_tasks where id = $1 and user_id = $2', [id, userId]);
    if (!r.rows[0]) throw notFound('Görev bulunamadı.');
    return r.rows[0];
  };

  const svc: Schedule = {
    async list(userId) {
      const r = await db.query<TaskRow>('select * from scheduled_tasks where user_id = $1 order by created_at desc', [userId]);
      return r.rows.map(toTaskDTO);
    },
    async get(userId, id) {
      return toTaskDTO(await one(userId, id));
    },
    async create(user, input, source) {
      if (user.isGuest) throw conflict('Zamanlanmış görev için hesap oluşturmalısın.');
      const count = await db.query<{ n: number }>('select count(*)::int as n from scheduled_tasks where user_id = $1', [user.id]);
      if ((count.rows[0]?.n ?? 0) >= SCHEDULE_LIMITS.tasks) throw conflict(`En fazla ${SCHEDULE_LIMITS.tasks} zamanlanmış görev olabilir.`);
      const next = computeNextRun(input.schedule, input.timezone, new Date());
      if (!next) throw conflict('Bu zaman geçmişte kaldı.');
      const r = await db.query<TaskRow>(
        `insert into scheduled_tasks (user_id, title, prompt, mode, schedule, timezone, enabled, next_run_at, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [user.id, input.title, input.prompt, input.mode, JSON.stringify(input.schedule), input.timezone, input.enabled, next, source],
      );
      return toTaskDTO(r.rows[0]!);
    },
    async update(userId, id, patch) {
      const cur = await one(userId, id);
      const schedule = patch.schedule ?? cur.schedule;
      const timezone = patch.timezone ?? cur.timezone;
      const enabled = patch.enabled ?? cur.enabled;
      let next: Date | null = cur.next_run_at;
      // Zaman ya da etkinlik değiştiyse yeniden hesapla (devre dışıyken de hesaplanır; açılınca hazır olsun).
      if (patch.schedule || patch.timezone || (patch.enabled && !cur.enabled)) {
        next = computeNextRun(schedule, timezone, new Date());
        if (!next && enabled) throw conflict('Bu zaman geçmişte kaldı.');
      }
      const r = await db.query<TaskRow>(
        `update scheduled_tasks set title = $3, prompt = $4, mode = $5, schedule = $6, timezone = $7, enabled = $8, next_run_at = $9, updated_at = now()
          where id = $1 and user_id = $2 returning *`,
        [id, userId, patch.title ?? cur.title, patch.prompt ?? cur.prompt, patch.mode ?? cur.mode, JSON.stringify(schedule), timezone, enabled, next],
      );
      return toTaskDTO(r.rows[0]!);
    },
    async remove(userId, id) {
      const r = await db.query('delete from scheduled_tasks where id = $1 and user_id = $2', [id, userId]);
      if (!r.rowCount) throw notFound('Görev bulunamadı.');
    },
    async runs(userId, id, limit = 20) {
      await one(userId, id);
      const r = await db.query<{ id: string; title: string; created_at: Date }>(
        'select id, title, created_at from chats where task_id = $1 and user_id = $2 order by created_at desc limit $3',
        [id, userId, limit],
      );
      return r.rows.map((c) => ({ chatId: c.id, title: c.title, at: c.created_at.toISOString() }));
    },
    loadOwned: one,
    async claimDue(limit) {
      const due = await db.query<TaskRow>(
        `select * from scheduled_tasks where enabled and next_run_at is not null and next_run_at <= now() order by next_run_at limit $1`,
        [limit],
      );
      const claimed: TaskRow[] = [];
      for (const t of due.rows) {
        const now = new Date();
        const late = now.getTime() - (t.next_run_at?.getTime() ?? now.getTime());
        const next = t.schedule.kind === 'once' ? null : computeNextRun(t.schedule, t.timezone, now);
        const stillEnabled = next !== null;
        // Atomik sahiplenme: satır hâlâ zamanı gelmiş durumdaysa (başka bir örnek almadıysa) ilerlet; ikinci alan 0 satır görür.
        const r = await db.query<TaskRow>(
          `update scheduled_tasks set next_run_at = $2, enabled = $3, last_run_at = now(), run_count = run_count + 1, updated_at = now()
            where id = $1 and enabled and next_run_at <= now() returning *`,
          [t.id, next, stillEnabled],
        );
        const row = r.rows[0];
        if (!row) continue;
        if (t.schedule.kind === 'once' && late > MISSED_ONCE_MS) {
          await svc.recordRun(t.id, { chatId: null, status: 'skipped', error: 'Sunucu kapalıyken zamanı geçti.' });
          continue;
        }
        claimed.push(row);
      }
      return claimed;
    },
    async recordRun(id, r) {
      await db.query('update scheduled_tasks set last_chat_id = coalesce($2, last_chat_id), last_status = $3, last_error = $4 where id = $1', [
        id,
        r.chatId,
        r.status,
        r.error ?? null,
      ]);
    },
    async authUser(userId) {
      const r = await db.query<UserRow>('select id, email, is_guest, email_verified_at, locale from users where id = $1', [userId]);
      const row = r.rows[0];
      if (!row) return null;
      const tier = tierOf(row);
      return { id: row.id, email: row.email, isGuest: row.is_guest, emailVerified: Boolean(row.email_verified_at), tier, limits: TIER_LIMITS[tier], locale: row.locale, sessionId: '' };
    },
    tools: () => scheduleTools(svc),
  };
  return svc;
}

/**
 * Zamanlayıcı: her `intervalMs`'de zamanı gelen görevleri alıp `run` ile çalıştırır.
 * Aynı anda en fazla `maxParallel` görev çalışır; fazlası sonraki turda (dakikalar içinde) alınır.
 */
export function startScheduler(opts: { schedule: Schedule; run: (task: ScheduledTask) => Promise<void>; log: FastifyBaseLogger; intervalMs?: number; maxParallel?: number }) {
  const { schedule, run, log } = opts;
  const maxParallel = opts.maxParallel ?? 3;
  let busy = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped || busy >= maxParallel) return;
    try {
      const due = await schedule.claimDue(maxParallel - busy);
      for (const t of due) {
        busy++;
        void run(t)
          .catch((err) => log.error({ err, taskId: t.id }, 'zamanlanmış görev çalıştırılamadı'))
          .finally(() => {
            busy--;
          });
      }
    } catch (err) {
      log.warn({ err }, 'zamanlayıcı turu başarısız');
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 30_000);
  timer.unref();
  void tick();
  return { stop: () => ((stopped = true), clearInterval(timer)), tick };
}

// ---------- Ajan araçları ----------

const SCHEDULE_PARAM = {
  type: 'object',
  description:
    'Ne zaman çalışacağı. Biri: {"kind":"once","at":"2026-10-20T09:00:00+03:00"} (tek sefer, ofsetli ISO), {"kind":"daily","time":"09:00"}, ' +
    '{"kind":"weekly","days":[1,3,5],"time":"18:30"} (1=Pazartesi … 7=Pazar), {"kind":"interval","minutes":120} (en az 30). Saatler İstanbul saatidir.',
  properties: {
    kind: { type: 'string', enum: ['once', 'daily', 'weekly', 'interval'] },
    at: { type: 'string' },
    time: { type: 'string' },
    days: { type: 'array', items: { type: 'integer' } },
    minutes: { type: 'integer' },
  },
  required: ['kind'],
};

const fmt = (t: ScheduledTaskDTO) =>
  `- ${t.id} · "${t.title}" · ${describeSchedule(t.schedule, 'tr', t.timezone)} · ${t.enabled ? 'açık' : 'kapalı'}${t.nextRunAt ? ` · sıradaki: ${t.nextRunAt}` : ''}`;

function scheduleTools(svc: Schedule): ToolDef[] {
  const member = (u: AuthUser) => !u.isGuest;
  const guard = <T>(fn: () => Promise<T>) => fn().catch((e: unknown) => {
    throw new ToolError(e instanceof Error ? e.message : 'İşlem başarısız.');
  });
  return [
    {
      name: 'schedule_create',
      description:
        'Zamanlanmış görev oluşturur: belirlenen zamanda `prompt` otomatik çalıştırılır ve sonuç kullanıcıya yeni bir sohbet olarak bırakılır (uygulamadaki "Zamanlanmış" bölümünde de görünür). ' +
        'Kullanıcı "her sabah …", "yarın 9\'da …", "haftada bir …" gibi tekrarlayan ya da ileri tarihli bir iş istediğinde kullan. `prompt` görev çalışırken kullanıcı olmadan, kendi başına anlaşılır olmalı. ' +
        'Görev çalışırken yeni zamanlanmış görev oluşturamaz.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Kısa başlık.' },
          prompt: { type: 'string', description: 'Zamanı gelince çalıştırılacak tam istem.' },
          schedule: SCHEDULE_PARAM,
          mode: { type: 'string', enum: ['fast', 'balanced', 'deep'], description: 'Çalışma modu: hızlı, dengeli (varsayılan) ya da derin.' },
        },
        required: ['title', 'prompt', 'schedule'],
      },
      available: member,
      async run(args, ctx) {
        const a = args as Record<string, unknown>;
        const spec = scheduleSpecSchema.safeParse(a.schedule);
        if (!spec.success) throw new ToolError(`schedule geçersiz: ${spec.error.issues[0]?.message ?? ''}. Örnek: {"kind":"daily","time":"09:00"}`);
        const input = createScheduledTaskSchema.safeParse({ title: a.title, prompt: a.prompt, mode: a.mode, schedule: spec.data, timezone: DEFAULT_TIMEZONE });
        if (!input.success) throw new ToolError(`Geçersiz değer (${input.error.issues[0]?.path.join('.')}): ${input.error.issues[0]?.message}`);
        const t = await guard(() => svc.create(ctx.user, input.data, 'agent'));
        return { output: `Görev oluşturuldu.\n${fmt(t)}`, summary: `Zamanlandı: ${t.title}`, meta: { taskId: t.id } };
      },
    },
    {
      name: 'schedule_list',
      description: 'Kullanıcının zamanlanmış görevlerini listeler (kimlik, başlık, zaman, durum).',
      parameters: { type: 'object', properties: {} },
      available: member,
      async run(_args, ctx) {
        const list = await svc.list(ctx.user.id);
        return { output: list.length ? list.map(fmt).join('\n') : 'Zamanlanmış görev yok.', summary: `${list.length} görev` };
      },
    },
    {
      name: 'schedule_update',
      description: 'Bir zamanlanmış görevi günceller (başlık, istem, zaman, mod) ya da açar/kapatır. Alanlardan yalnızca değişenleri gönder.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'schedule_list çıktısındaki görev kimliği.' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          schedule: SCHEDULE_PARAM,
          mode: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
          enabled: { type: 'boolean' },
        },
        required: ['id'],
      },
      available: member,
      async run(args, ctx) {
        const { id, ...rest } = args as Record<string, unknown>;
        if (typeof id !== 'string') throw new ToolError('id gerekli.');
        const patch = updateScheduledTaskSchema.safeParse(rest);
        if (!patch.success) throw new ToolError(`Geçersiz değer (${patch.error.issues[0]?.path.join('.')}): ${patch.error.issues[0]?.message}`);
        const t = await guard(() => svc.update(ctx.user.id, id, patch.data));
        return { output: `Güncellendi.\n${fmt(t)}`, summary: `Güncellendi: ${t.title}` };
      },
    },
    {
      name: 'schedule_delete',
      description: 'Bir zamanlanmış görevi siler. Silmeden önce kullanıcıdan onay al.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      available: member,
      async run(args, ctx) {
        const id = (args as { id?: unknown }).id;
        if (typeof id !== 'string') throw new ToolError('id gerekli.');
        await guard(() => svc.remove(ctx.user.id, id));
        return { output: 'Silindi.', summary: 'Görev silindi' };
      },
    },
  ];
}
