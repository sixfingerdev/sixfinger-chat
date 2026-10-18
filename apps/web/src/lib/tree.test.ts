import { describe, expect, it } from 'vitest';
import type { MessageDTO } from '@sixfinger/shared';
import { activePath, deepestLeaf, indexMessages, versionsOf } from './tree.ts';

const m = (id: string, parentId: string | null, role: 'user' | 'assistant', t: number): MessageDTO => ({
  id,
  chatId: 'c',
  parentId,
  role,
  content: id,
  reasoning: '',
  status: 'complete',
  model: null,
  attachments: [],
  feedback: null,
  reasoningMs: null,
  parts: [],
  createdAt: new Date(2026, 0, 1, 0, 0, t).toISOString(),
});

// u1 -> a1 -> u2 -> a2
//    \-> a1b            (a1'in kardeşi)
// u1b (u1'in kardeşi) -> a3
const msgs = [
  m('u1', null, 'user', 1),
  m('a1', 'u1', 'assistant', 2),
  m('u2', 'a1', 'user', 3),
  m('a2', 'u2', 'assistant', 4),
  m('a1b', 'u1', 'assistant', 5),
  m('u1b', null, 'user', 6),
  m('a3', 'u1b', 'assistant', 7),
];

describe('mesaj ağacı', () => {
  const idx = indexMessages(msgs);

  it('aktif yolu yapraktan köke doğru çıkarır', () => {
    expect(activePath(idx, 'a2').map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(activePath(idx, 'a1b').map((x) => x.id)).toEqual(['u1', 'a1b']);
    expect(activePath(idx, null)).toEqual([]);
  });

  it('kardeş sürümleri sıralı verir', () => {
    expect(versionsOf(idx, idx.byId.get('a1')!)).toMatchObject({ index: 0, total: 2 });
    expect(versionsOf(idx, idx.byId.get('a1b')!)).toMatchObject({ index: 1, total: 2 });
    expect(versionsOf(idx, idx.byId.get('u1b')!)).toMatchObject({ index: 1, total: 2 });
  });

  it('bir sürüme geçince o dalın en derin yaprağını bulur', () => {
    expect(deepestLeaf(idx, 'u1')).toBe('a1b'); // en yeni çocuk a1b
    expect(deepestLeaf(idx, 'a1')).toBe('a2');
    expect(deepestLeaf(idx, 'u1b')).toBe('a3');
  });
});
