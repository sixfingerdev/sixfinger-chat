import { destroyCodeWorkspaces } from '../services/code-cleanup.ts';
import type { FastifyInstance } from 'fastify';
import {
  MODELS,
  PERSONAS,
  TIER_LIMITS,
  deleteAccountSchema,
  memorySchema,
  profileSchema,
  type ConfigDTO,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { verifyPassword } from '../lib/crypto.ts';
import { HttpError, notFound, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { addMemory, deleteMemory, listMemories } from '../services/memories.ts';
import { findUserById, toUserDTO } from '../services/users.ts';

export function meRoutes(ctx: AppContext, guard: Guard) {
  const { db, usage, sessions, config } = ctx;

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);

    app.get('/me', async (req) => {
      const row = await findUserById(db, req.user!.id);
      return { user: toUserDTO(row!) };
    });

    app.get('/config', async (req): Promise<ConfigDTO & { personas: typeof PERSONAS; models: typeof MODELS }> => {
      const user = req.user!;
      return {
        tier: user.tier,
        limits: TIER_LIMITS[user.tier],
        usage: await usage.get(user.id, user.tier),
        smtpEnabled: config.smtpEnabled,
        code: { allowed: ctx.code.isAllowed(user) },
        personas: PERSONAS,
        models: MODELS,
      };
    });

    app.get('/usage', async (req) => usage.get(req.user!.id, req.user!.tier));

    app.patch('/me', async (req) => {
      const user = req.user!;
      const body = parse(profileSchema, req.body);
      const s = body.settings ?? {};
      const touchesProfileText = s.customName !== undefined || s.about !== undefined || s.instructions !== undefined;
      if (touchesProfileText && !user.limits.features.customInstructions) {
        throw tierRestricted('Özel talimatlar için hesap oluşturmalısın.');
      }
      if (s.memoryEnabled !== undefined && !user.limits.features.memory) {
        throw tierRestricted('Hafıza için e-postanı doğrulamış bir hesap gerekir.');
      }
      if (s.defaultPersona !== undefined) {
        if (!PERSONAS.some((p) => p.id === s.defaultPersona)) throw new HttpError(400, 'bad_request', 'Bilinmeyen rol.');
        if (s.defaultPersona !== 'default' && !user.limits.features.personas) {
          throw tierRestricted('Roller için hesap oluşturmalısın.');
        }
      }
      if (body.displayName !== undefined || body.locale !== undefined) {
        await db.query(
          `update users set display_name = coalesce($2, display_name), locale = coalesce($3, locale), updated_at = now()
            where id = $1`,
          [user.id, body.displayName ?? null, body.locale ?? null],
        );
      }
      if (Object.keys(s).length) {
        await db.query(
          `insert into user_settings (user_id, custom_name, about, instructions, default_persona, memory_enabled)
           values ($1, coalesce($2, ''), coalesce($3, ''), coalesce($4, ''), coalesce($5, 'default'), coalesce($6, true))
           on conflict (user_id) do update set
             custom_name = coalesce($2, user_settings.custom_name),
             about = coalesce($3, user_settings.about),
             instructions = coalesce($4, user_settings.instructions),
             default_persona = coalesce($5, user_settings.default_persona),
             memory_enabled = coalesce($6, user_settings.memory_enabled)`,
          [
            user.id,
            s.customName ?? null,
            s.about ?? null,
            s.instructions ?? null,
            s.defaultPersona ?? null,
            s.memoryEnabled ?? null,
          ],
        );
      }
      const row = await findUserById(db, user.id);
      return { user: toUserDTO(row!) };
    });

    app.delete('/me', async (req, reply) => {
      const user = req.user!;
      const body = parse(deleteAccountSchema, req.body);
      const row = await findUserById(db, user.id);
      if (row?.password_hash) {
        if (!body.password || !(await verifyPassword(body.password, row.password_hash))) {
          throw new HttpError(401, 'invalid_credentials', 'Şifre hatalı.');
        }
      }
      // Hesapla birlikte tüm Code çalışma alanları da silinir.
      const codeChats = (await db.query<{ id: string }>("select id from chats where user_id = $1 and kind = 'code'", [user.id])).rows.map((r) => r.id);
      await db.query('delete from users where id = $1', [user.id]);
      await destroyCodeWorkspaces(ctx, user.id, codeChats);
      return reply.code(204).send();
    });

    // --- Oturumlar ---
    app.get('/me/sessions', async (req) => ({
      sessions: await sessions.list(req.user!.id, req.user!.sessionId),
    }));

    app.delete<{ Params: { id: string } }>('/me/sessions/:id', async (req, reply) => {
      if (!(await sessions.revokeOne(req.user!.id, req.params.id))) throw notFound('Oturum bulunamadı.');
      return reply.code(204).send();
    });

    // --- Hafıza ---
    app.get('/memories', async (req) => {
      if (!req.user!.limits.features.memory) return { memories: [] };
      return { memories: await listMemories(db, req.user!.id) };
    });

    app.post('/memories', async (req, reply) => {
      const user = req.user!;
      if (!user.limits.features.memory) throw tierRestricted('Hafıza için e-postanı doğrulamış bir hesap gerekir.');
      const { content } = parse(memorySchema, req.body);
      return reply.code(201).send({ memory: await addMemory(db, user.id, content) });
    });

    app.delete<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
      if (!(await deleteMemory(db, req.user!.id, req.params.id))) throw notFound('Kayıt bulunamadı.');
      return reply.code(204).send();
    });

    app.delete('/memories', async (req, reply) => {
      await db.query('delete from memories where user_id = $1', [req.user!.id]);
      return reply.code(204).send();
    });

    // --- Veri dışa aktarma (tüm sohbetler) ---
    app.get('/me/export', async (req) => {
      const user = req.user!;
      if (!user.limits.features.exportAll) throw tierRestricted('Dışa aktarma için hesap oluşturmalısın.');
      const chats = await db.query(
        `select c.id, c.title, c.persona_id, c.created_at,
                coalesce((select json_agg(json_build_object('id', m.id, 'parentId', m.parent_id, 'role', m.role,
                          'content', m.content, 'reasoning', m.reasoning, 'createdAt', m.created_at) order by m.seq)
                          from messages m where m.chat_id = c.id), '[]'::json) as messages
           from chats c where c.user_id = $1 and c.kind = 'chat' and c.last_message_at is not null order by c.created_at`,
        [user.id],
      );
      const row = await findUserById(db, user.id);
      return {
        exportedAt: new Date().toISOString(),
        user: toUserDTO(row!),
        memories: await listMemories(db, user.id),
        chats: chats.rows,
      };
    });
  };
}
