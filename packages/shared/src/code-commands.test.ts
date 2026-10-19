import { describe, expect, it } from 'vitest';
import { BUILTIN_COMMANDS, activeMention, buildAnswerText, expandTemplate, matchCommands, parseRepoCommand, parseSlash } from './code-commands.ts';

describe('slash komutları', () => {
  it('ayrıştırır', () => {
    expect(parseSlash('/review login akışı')).toEqual({ name: 'review', args: 'login akışı' });
    expect(parseSlash('  /Plan  ')).toEqual({ name: 'plan', args: '' });
    expect(parseSlash('merhaba /x')).toBeNull();
    expect(parseSlash('/')).toBeNull();
  });
  it('şablonu doldurur; yer tutucu yoksa argümanı sona ekler', () => {
    expect(expandTemplate('Test et. $ARGUMENTS', 'yalnızca auth')).toBe('Test et. yalnızca auth');
    expect(expandTemplate('Test et. $ARGUMENTS', '')).toBe('Test et.');
    expect(expandTemplate('Düzelt', 'şunu')).toBe('Düzelt\n\nşunu');
  });
  it('öntanıya göre süzer, yerleşikler önce gelir', () => {
    const all = [...BUILTIN_COMMANDS, { name: 'perf', kind: 'send' as const, source: 'repo' as const, template: 'x' }];
    expect(matchCommands(all, '/p').map((c) => c.name)).toEqual(['plan', 'pr', 'perf']);
    expect(matchCommands(all, '/co').map((c) => c.name)).toEqual(['compact']);
    expect(matchCommands(all, '/').length).toBe(all.length);
  });
  it('repo komut dosyasını (frontmatter ile ya da düz) okur', () => {
    expect(parseRepoCommand('.claude/commands/Fix-Lint.md', '---\ndescription: "Lint hatalarını düzelt"\n---\nLint çalıştır ve düzelt $ARGUMENTS')).toEqual({
      name: 'fix-lint', kind: 'send', template: 'Lint çalıştır ve düzelt $ARGUMENTS', description: 'Lint hatalarını düzelt', source: 'repo',
    });
    expect(parseRepoCommand('.sixfinger/commands/deploy.md', '# Yayınla\nAdımlar...')).toMatchObject({ name: 'deploy', description: 'Yayınla' });
    expect(parseRepoCommand('x.md', '   ')).toBeNull();
  });
});

describe('soru yanıtı ve @dosya', () => {
  it('yanıtları tek metne çevirir', () => {
    expect(buildAnswerText([{ question: 'Hangi DB?', header: 'DB', options: [{ label: 'A' }, { label: 'B' }] }, { question: 'Test?', options: [{ label: 'x' }, { label: 'y' }], multiSelect: true }], [['Postgres'], ['x', 'y']])).toBe('DB: Hangi DB? → Postgres\nTest? → x, y');
  });
  it('imlecteki @ kelimesini bulur', () => {
    expect(activeMention('şunu oku @src/au')).toEqual({ query: 'src/au', start: 9 });
    expect(activeMention('@')).toEqual({ query: '', start: 0 });
    expect(activeMention('mail a@b.com')).toBeNull();
    expect(activeMention('bitti.')).toBeNull();
  });
});
