import type { FastifyInstance } from 'fastify';
import { PERSONAS, createChatSchema, listChatsQuery, updateChatSchema } from '@sixfinger/shared';
import type { ChatDetailDTO } from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { randomSlug } from '../lib/crypto.ts';
import { badRequest, notFound, tierRestricted } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import {
  MESSAGE_COLUMNS,
  deepestLeaf,
  escapeLike,
  getOwnedChat,
  toChatDTO,
  toMessageDTO,
  type ChatRow,
  type MessageRow,
} from '../services/chats.ts';
import { imageRefs } from '../services/images.ts';
import { findUserById, settingsOf } from '../services/users.ts';
import { destroyCodeWorkspaces } from '../services/code-cleanup.ts';

export function chatRoutes(ctx: AppContext, guard: Guard) {
  const { db } = ctx;

  return async function (app: FastifyInstance) {
    app.addHook('preHandler', guard.requireUser);

    app.get('/chats', async (req) => {
      const user = req.user!;
      const q = parse(listChatsQuery, req.query);
      if (q.q && !user.limits.features.search) {
        throw tierRestricted('Sohbetlerde arama için hesap oluşturmalısın.');
      }
      const like = q.q ? `%${escapeLike(q.q)}%` : null;
      const r = await db.query<ChatRow>(
        `select c.*, sh.slug as share_slug,
                case when $3::text is null then null else
                  (select m.content from messages m where m.chat_id = c.id and m.content ilike $3 order by m.seq limit 1)
                end as snippet
           from chats c left join shares sh on sh.chat_id = c.id
          where c.user_id = $1 and c.kind = 'chat' and c.last_message_at is not null and c.archived = $2
            and ($3::text is null or c.title ilike $3
                 or exists (select 1 from messages m where m.chat_id = c.id and m.content ilike $3))
          order by c.pinned desc, c.last_message_at desc
          limit $4`,
        [user.id, q.archived === 'true', like, q.limit ?? 200],
      );
      return { chats: r.rows.map((c) => toChatDTO(c, q.q)) };
    });

    app.post('/chats', async (req, reply) => {
      const user = req.user!;
      const body = parse(createChatSchema, req.body);
      const count = await db.query<{ n: number }>(
        "select count(*)::int as n from chats where user_id = $1 and kind = 'chat' and last_message_at is not null",
        [user.id],
      );
      if ((count.rows[0]?.n ?? 0) >= user.limits.maxChats) {
        throw tierRestricted(
          user.isGuest
            ? `Misafirler en fazla ${user.limits.maxChats} sohbet saklayabilir. Hesap oluştur ya da eski bir sohbeti sil.`
            : 'Sohbet sınırına ulaştın. Eski sohbetleri sil.',
        );
      }
      let personaId = body.personaId;
      if (!personaId) {
        const row = await findUserById(db, user.id);
        personaId = user.limits.features.personas ? settingsOf(row!).defaultPersona : 'default';
      }
      if (!PERSONAS.some((p) => p.id === personaId)) throw badRequest('Bilinmeyen rol.');
      if (personaId !== 'default' && !user.limits.features.personas) {
        throw tierRestricted('Roller için hesap oluşturmalısın.');
      }
      const r = await db.query<ChatRow>(
        `insert into chats (user_id, title, persona_id, title_generated)
         values ($1, $2, $3, $4) returning *`,
        [user.id, body.title ?? 'Yeni sohbet', personaId, Boolean(body.title)],
      );
      return reply.code(201).send({ chat: toChatDTO(r.rows[0]!) });
    });

    app.get<{ Params: { id: string } }>('/chats/:id', async (req): Promise<ChatDetailDTO> => {
      const chat = await getOwnedChat(db, req.params.id, req.user!.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      // Sunucu yeniden başlamışsa ya da üretim ölmüşse 'streaming' kalmış mesajlar sonsuza dek "yazıyor" görünmesin.
      // (Kısa bir süre tanınır: yeni başlayan üretim kaydı henüz oluşuyor olabilir.)
      await db.query(
        `update messages set status = 'stopped'
          where chat_id = $1 and status = 'streaming' and created_at < now() - interval '20 seconds'
            and not (id = any($2::uuid[]))`,
        [chat.id, ctx.runs.activeIds(chat.id)],
      );
      const m = await db.query<MessageRow>(
        `select ${MESSAGE_COLUMNS} from messages where chat_id = $1 order by seq`,
        [chat.id],
      );
      const refs = await imageRefs(db, m.rows.filter((r) => r.role === 'user').map((r) => r.id));
      return { chat: toChatDTO(chat), messages: m.rows.map((r) => toMessageDTO(r, refs.get(r.id))) };
    });

    // Mesaja eklenmiş görselin baytları (yalnızca sahibi). Değişmez: uzun süre önbelleğe alınır.
    app.get<{ Params: { id: string } }>('/images/:id', async (req, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Görsel bulunamadı.');
      const r = await db.query<{ mime: string; data: Buffer }>('select mime, data from message_images where id = $1 and user_id = $2', [req.params.id, req.user!.id]);
      const row = r.rows[0];
      if (!row) throw notFound('Görsel bulunamadı.');
      return reply.header('cache-control', 'private, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').type(row.mime).send(row.data);
    });

    app.patch<{ Params: { id: string } }>('/chats/:id', async (req) => {
      const user = req.user!;
      const body = parse(updateChatSchema, req.body);
      const chat = await getOwnedChat(db, req.params.id, user.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      if (body.pinned !== undefined && !user.limits.features.pin) {
        throw tierRestricted('Sohbet sabitlemek için hesap oluşturmalısın.');
      }
      if (body.personaId !== undefined) {
        if (!PERSONAS.some((p) => p.id === body.personaId)) throw badRequest('Bilinmeyen rol.');
        if (body.personaId !== 'default' && !user.limits.features.personas) {
          throw tierRestricted('Roller için hesap oluşturmalısın.');
        }
      }
      let leafId = body.leafId;
      if (leafId) {
        const ok = await db.query('select 1 from messages where id = $1 and chat_id = $2', [leafId, chat.id]);
        if (!ok.rowCount) throw badRequest('Mesaj bu sohbete ait değil.');
        // Bir sürüme geçildiğinde o dalın en yeni ucuna git.
        leafId = await deepestLeaf(db, chat.id, leafId);
      }
      const r = await db.query<ChatRow>(
        `update chats set
            title = coalesce($3, title),
            title_generated = case when $3 is not null then true else title_generated end,
            pinned = coalesce($4, pinned),
            archived = coalesce($5, archived),
            persona_id = coalesce($6, persona_id),
            leaf_id = coalesce($7, leaf_id),
            updated_at = now()
          where id = $1 and user_id = $2 returning *`,
        [chat.id, user.id, body.title ?? null, body.pinned ?? null, body.archived ?? null, body.personaId ?? null, leafId ?? null],
      );
      return { chat: toChatDTO({ ...r.rows[0]!, share_slug: chat.share_slug }) };
    });

    app.delete<{ Params: { id: string } }>('/chats/:id', async (req, reply) => {
      const r = await db.query<{ kind: string }>('delete from chats where id = $1 and user_id = $2 returning kind', [req.params.id, req.user!.id]);
      if (!r.rowCount) throw notFound('Sohbet bulunamadı.');
      // Code oturumuysa çalışma alanı (sandbox) da silinir.
      if (r.rows[0]!.kind === 'code') await destroyCodeWorkspaces(ctx, req.user!.id, [req.params.id]);
      return reply.code(204).send();
    });

    app.delete('/chats', async (req, reply) => {
      await db.query("delete from chats where user_id = $1 and kind = 'chat'", [req.user!.id]);
      return reply.code(204).send();
    });

    // --- Paylaşım ---
    app.post<{ Params: { id: string } }>('/chats/:id/share', async (req, reply) => {
      const user = req.user!;
      if (!user.limits.features.share) throw tierRestricted('Paylaşım için e-postanı doğrulamış bir hesap gerekir.');
      const chat = await getOwnedChat(db, req.params.id, user.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      if (!chat.leaf_id) throw badRequest('Boş sohbet paylaşılamaz.');
      const path = await db.query<MessageRow>(
        `with recursive path as (
           select ${MESSAGE_COLUMNS}, seq from messages where id = $1
           union all
           select ${MESSAGE_COLUMNS.split(', ').map((c) => `m.${c}`).join(', ')}, m.seq
             from messages m join path p on m.id = p.parent_id
         ) select ${MESSAGE_COLUMNS} from path order by seq`,
        [chat.leaf_id],
      );
      const snapshot = path.rows
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ id: m.id, role: m.role, content: m.content, reasoning: '', createdAt: m.created_at.toISOString() }));
      const slug = randomSlug(10);
      const r = await db.query<{ slug: string }>(
        `insert into shares (slug, chat_id, user_id, title, snapshot) values ($1, $2, $3, $4, $5)
         on conflict (chat_id) do update set snapshot = excluded.snapshot, title = excluded.title, created_at = now()
         returning slug`,
        [slug, chat.id, user.id, chat.title, JSON.stringify(snapshot)],
      );
      const slugOut = r.rows[0]!.slug;
      return reply.code(201).send({ slug: slugOut, url: `${ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/s/${slugOut}` });
    });

    app.delete<{ Params: { id: string } }>('/chats/:id/share', async (req, reply) => {
      const chat = await getOwnedChat(db, req.params.id, req.user!.id);
      if (!chat) throw notFound('Sohbet bulunamadı.');
      await db.query('delete from shares where chat_id = $1', [chat.id]);
      return reply.code(204).send();
    });
  };
}

