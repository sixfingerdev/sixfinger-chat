import type { MessageDTO } from '@sixfinger/shared';

export interface TreeIndex {
  byId: Map<string, MessageDTO>;
  children: Map<string | null, MessageDTO[]>;
}

export function indexMessages(messages: MessageDTO[]): TreeIndex {
  const byId = new Map<string, MessageDTO>();
  const children = new Map<string | null, MessageDTO[]>();
  for (const m of messages) {
    byId.set(m.id, m);
    const list = children.get(m.parentId) ?? [];
    list.push(m);
    children.set(m.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { byId, children };
}

/** `leafId`'den köke giden aktif yol (eskiden yeniye). */
export function activePath(idx: TreeIndex, leafId: string | null): MessageDTO[] {
  const out: MessageDTO[] = [];
  let cur = leafId ? idx.byId.get(leafId) : undefined;
  while (cur) {
    out.push(cur);
    cur = cur.parentId ? idx.byId.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

export interface Versions {
  index: number;
  total: number;
  ids: string[];
}

/** Bir mesajın kardeş sürümleri (düzenleme / yeniden üretme). */
export function versionsOf(idx: TreeIndex, msg: MessageDTO): Versions {
  const siblings = idx.children.get(msg.parentId) ?? [msg];
  const ids = siblings.map((s) => s.id);
  return { index: Math.max(0, ids.indexOf(msg.id)), total: ids.length, ids };
}

/** Bir düğümden başlayıp her adımda en yeni çocuğu seçerek en derindeki yaprağı bulur. */
export function deepestLeaf(idx: TreeIndex, fromId: string): string {
  let cur = fromId;
  for (;;) {
    const kids = idx.children.get(cur);
    if (!kids?.length) return cur;
    cur = kids[kids.length - 1]!.id;
  }
}
