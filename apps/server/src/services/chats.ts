import type { AttachmentDTO, ChatDTO, MessageDTO, MessagePartDTO } from '@sixfinger/shared';
import type { Queryable } from '../db/pool.ts';

export interface ChatRow {
  id: string;
  user_id: string;
  title: string;
  title_generated: boolean;
  persona_id: string;
  pinned: boolean;
  archived: boolean;
  leaf_id: string | null;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
  share_slug?: string | null;
  snippet?: string | null;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  parent_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  reasoning_ms: number | null;
  status: MessageDTO['status'];
  model: string | null;
  attachments: AttachmentDTO[];
  parts: MessagePartDTO[];
  feedback: number | null;
  created_at: Date;
}

export const MESSAGE_COLUMNS =
  'id, chat_id, parent_id, role, content, reasoning, reasoning_ms, status, model, attachments, parts, feedback, created_at';

export function toChatDTO(c: ChatRow, query?: string): ChatDTO {
  return {
    id: c.id,
    title: c.title,
    personaId: c.persona_id,
    pinned: c.pinned,
    archived: c.archived,
    leafId: c.leaf_id,
    shareSlug: c.share_slug ?? null,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    lastMessageAt: c.last_message_at?.toISOString() ?? null,
    ...(c.snippet ? { snippet: makeSnippet(c.snippet, query) } : {}),
  };
}

export function toMessageDTO(m: MessageRow): MessageDTO {
  return {
    id: m.id,
    chatId: m.chat_id,
    parentId: m.parent_id,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning,
    status: m.status,
    model: m.model,
    attachments: m.attachments ?? [],
    feedback: m.feedback === 1 ? 1 : m.feedback === -1 ? -1 : null,
    reasoningMs: m.reasoning_ms,
    parts: m.parts ?? [],
    createdAt: m.created_at.toISOString(),
  };
}

function makeSnippet(text: string, query?: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, 140);
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return flat.slice(0, 140);
  const start = Math.max(0, i - 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + 150)}${start + 150 < flat.length ? '…' : ''}`;
}

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getOwnedChat(db: Queryable, chatId: string, userId: string): Promise<ChatRow | null> {
  const r = await db.query<ChatRow>(
    `select c.*, sh.slug as share_slug from chats c left join shares sh on sh.chat_id = c.id
      where c.id = $1 and c.user_id = $2`,
    [chatId, userId],
  );
  return r.rows[0] ?? null;
}

/** `messageId` düğümünden köke giden yol (eskiden yeniye). */
export async function getPath(
  db: Queryable,
  messageId: string | null,
): Promise<Pick<MessageRow, 'id' | 'role' | 'content' | 'attachments' | 'parts' | 'status'>[]> {
  if (!messageId) return [];
  const r = await db.query(
    `with recursive path as (
       select id, parent_id, role, content, attachments, parts, status, seq from messages where id = $1
       union all
       select m.id, m.parent_id, m.role, m.content, m.attachments, m.parts, m.status, m.seq
         from messages m join path p on m.id = p.parent_id
     ) select id, role, content, attachments, parts, status from path order by seq`,
    [messageId],
  );
  return r.rows;
}

/** Bir düğümden başlayarak en yeni alt dalın yaprağını bulur (sürüm değiştirirken). */
export async function deepestLeaf(db: Queryable, chatId: string, fromId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `with recursive down as (
       select id, 0 as depth, seq from messages where id = $1 and chat_id = $2
       union all
       select m.id, d.depth + 1, m.seq from messages m
         join down d on m.parent_id = d.id
        where m.seq = (select max(seq) from messages where parent_id = d.id)
     ) select id from down order by depth desc limit 1`,
    [fromId, chatId],
  );
  return r.rows[0]?.id ?? fromId;
}
