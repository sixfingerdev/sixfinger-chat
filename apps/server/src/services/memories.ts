import { MEMORY_MAX_CHARS, MEMORY_MAX_ITEMS, type MemoryDTO } from '@sixfinger/shared';
import type { Queryable } from '../db/pool.ts';
import { HttpError } from '../lib/errors.ts';

interface Row {
  id: string;
  content: string;
  created_at: Date;
}
const toDTO = (r: Row): MemoryDTO => ({ id: r.id, content: r.content, createdAt: r.created_at.toISOString() });

export async function listMemories(db: Queryable, userId: string): Promise<MemoryDTO[]> {
  const r = await db.query<Row>('select id, content, created_at from memories where user_id = $1 order by created_at desc', [
    userId,
  ]);
  return r.rows.map(toDTO);
}

export async function addMemory(db: Queryable, userId: string, content: string): Promise<MemoryDTO> {
  const text = content.trim().slice(0, MEMORY_MAX_CHARS);
  const count = await db.query<{ n: number }>('select count(*)::int as n from memories where user_id = $1', [userId]);
  if ((count.rows[0]?.n ?? 0) >= MEMORY_MAX_ITEMS) {
    throw new HttpError(409, 'conflict', `En fazla ${MEMORY_MAX_ITEMS} hafıza kaydı tutulabilir. Eskilerini sil.`);
  }
  const dup = await db.query<Row>(
    'select id, content, created_at from memories where user_id = $1 and lower(content) = lower($2)',
    [userId, text],
  );
  if (dup.rows[0]) return toDTO(dup.rows[0]);
  const r = await db.query<Row>(
    'insert into memories (user_id, content) values ($1, $2) returning id, content, created_at',
    [userId, text],
  );
  return toDTO(r.rows[0]!);
}

export async function deleteMemory(db: Queryable, userId: string, id: string): Promise<boolean> {
  const r = await db.query('delete from memories where id = $1 and user_id = $2', [id, userId]);
  return (r.rowCount ?? 0) > 0;
}
