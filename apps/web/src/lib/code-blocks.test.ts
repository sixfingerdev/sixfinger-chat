import { describe, expect, it } from 'vitest';
import type { MessagePartDTO } from '@sixfinger/shared';
import { diffLines, toBlocks } from './code-blocks.ts';

const tool = (id: string, name: string, extra: object = {}): MessagePartDTO => ({ type: 'tool', id, name, args: {}, status: 'done', ...extra });

describe('toBlocks', () => {
  it('ardışık komut/okuma/arama parçalarını tek grupta toplar, dosya düzenlemeleri araya girince böler', () => {
    const blocks = toBlocks([
      tool('1', 'bash'),
      tool('2', 'read'),
      tool('3', 'grep'),
      tool('4', 'edit'),
      tool('5', 'bash'),
      { type: 'text', text: 'bitti' },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['group', 'file', 'group', 'text']);
    expect(blocks[0]).toMatchObject({ kind: 'group', parts: [{ id: '1' }, { id: '2' }, { id: '3' }] });
  });

  it('yalnızca son yapılacaklar listesini gösterir; workspace ve commit ayrı bloklardır', () => {
    const blocks = toBlocks([tool('w', 'workspace'), tool('t1', 'todo'), tool('b', 'bash'), tool('t2', 'todo'), tool('c', 'commit')]);
    expect(blocks.map((b) => b.kind)).toEqual(['workspace', 'group', 'todo', 'commit']);
    expect(blocks[2]).toMatchObject({ kind: 'todo', part: { id: 't2' } });
  });

  it('özetleme parçası kendi satırı olur ve komut grubunu böler', () => {
    expect(toBlocks([tool('1', 'bash'), tool('c', 'compaction'), tool('2', 'bash')]).map((b) => b.kind)).toEqual(['group', 'compaction', 'group']);
  });

  it('ajanın PR satırı kendi bloğudur', () => {
    expect(toBlocks([tool('c', 'commit'), tool('p', 'pull_request')]).map((b) => b.kind)).toEqual(['commit', 'pull_request']);
  });

  it('metinle bölünen komutlar ayrı gruplardır; düşünce son parçaysa işaretlenir', () => {
    const blocks = toBlocks([tool('1', 'bash'), { type: 'text', text: 'x' }, tool('2', 'bash'), { type: 'reasoning', text: 'düşünüyor', ms: null }]);
    expect(blocks.map((b) => b.kind)).toEqual(['group', 'text', 'group', 'reasoning']);
    expect(blocks[3]).toMatchObject({ last: true });
  });
});

describe('diffLines', () => {
  it('ortak baş/son satırları bağlam olarak (en çok 2) kırpar, farkı -/+ verir', () => {
    const old = 'a\nb\nc\nd\ne\nf\n';
    const next = 'a\nb\nc\nX\nY\ne\nf\n';
    expect(diffLines(old, next)).toEqual([
      { kind: 'ctx', text: 'b' },
      { kind: 'ctx', text: 'c' },
      { kind: 'del', text: 'd' },
      { kind: 'add', text: 'X' },
      { kind: 'add', text: 'Y' },
      { kind: 'ctx', text: 'e' },
      { kind: 'ctx', text: 'f' },
    ]);
  });

  it('yeni dosyada (eski boş) hepsi eklenmiş olur', () => {
    expect(diffLines('', 'x\ny\n')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });
});
