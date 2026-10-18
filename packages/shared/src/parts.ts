import type { MessageDTO, MessagePartDTO } from './types.ts';

/**
 * Mesajın sıralı parçaları: düşünce → (araç → düşünce)* → metin. Eski mesajlarda (parça yok ya da düşünce parçası yok)
 * `content` ve `reasoning` alanlarından aynı sırada üretilir; istemciler yalnızca bunu kullanmalı.
 */
export function messageParts(m: Pick<MessageDTO, 'parts' | 'content' | 'reasoning' | 'reasoningMs'>): MessagePartDTO[] {
  const parts = m.parts ?? [];
  const base: MessagePartDTO[] = parts.length ? parts : m.content ? [{ type: 'text', text: m.content }] : [];
  if (!parts.some((p) => p.type === 'reasoning') && m.reasoning) {
    return [{ type: 'reasoning', text: m.reasoning, ms: m.reasoningMs }, ...base];
  }
  return base;
}
