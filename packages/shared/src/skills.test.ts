import { describe, expect, it } from 'vitest';
import { matchSkills, parseFrontmatter, parseSkillMd, safeSkillPath, serializeSkillMd, type SkillSummary } from './skills.ts';

const md = (head: string, body = 'Adım 1: yap.') => `---\n${head}\n---\n\n${body}\n`;

describe('SKILL.md çözümleyici', () => {
  it('ad, açıklama, katlı blok, liste ve gövdeyi okur; bilinmeyen alanlar yetki vermez', () => {
    const r = parseSkillMd(
      md('name: web-app\ndescription: >\n  Builds small web apps.\n  Use for games.\ntriggers: [oyun, "web sayfası", game]\nlicense: MIT\nallowed-tools: bash(rm -rf)', '# Başlık\n\nİçerik'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill.name).toBe('web-app');
    expect(r.skill.description).toBe('Builds small web apps. Use for games.');
    expect(r.skill.triggers).toEqual(['oyun', 'web sayfası', 'game']);
    expect(r.skill.license).toBe('MIT');
    expect(r.skill.body).toBe('# Başlık\n\nİçerik');
    expect(r.skill.extra['allowed-tools']).toBe('bash(rm -rf)'); // yok sayılır, yalnızca saklanır
  });

  it('madde listesi (- a) ve CRLF; ad yoksa klasör adı kullanılır', () => {
    const r = parseSkillMd(`---\r\ndescription: x y\r\ntriggers:\r\n  - one\r\n  - two\r\n---\r\ngövde`, 'klasor-adi');
    expect(r.ok && r.skill.name).toBe('klasor-adi');
    expect(r.ok && r.skill.triggers).toEqual(['one', 'two']);
  });

  it('hatalar: başlık yok, ad geçersiz, açıklama yok, gövde boş/çok büyük', () => {
    expect(parseSkillMd('merhaba')).toMatchObject({ ok: false });
    expect(parseSkillMd(md('name: Bad Name\ndescription: x'))).toMatchObject({ ok: false, error: expect.stringContaining('küçük harf') });
    expect(parseSkillMd(md('name: ok'))).toMatchObject({ ok: false, error: expect.stringContaining('description') });
    expect(parseSkillMd(md('name: ok\ndescription: d', ''))).toMatchObject({ ok: false, error: expect.stringContaining('boş') });
    expect(parseSkillMd(md('name: ok\ndescription: d', 'x'.repeat(20_001)))).toMatchObject({ ok: false, error: expect.stringContaining('20000') });
    expect(parseSkillMd(md(`name: ok\ndescription: ${'d'.repeat(1025)}`))).toMatchObject({ ok: false });
  });

  it('serializeSkillMd ↔ parseSkillMd gidiş-dönüş', () => {
    const text = serializeSkillMd({ name: 'a-b', description: 'Açıklama: iki nokta, "tırnak"', triggers: ['x y', 'z'], body: 'Gövde\n\n- madde' });
    const r = parseSkillMd(text);
    expect(r.ok && r.skill).toMatchObject({ name: 'a-b', description: 'Açıklama: iki nokta, "tırnak"', triggers: ['x y', 'z'], body: 'Gövde\n\n- madde' });
  });

  it('parseFrontmatter: başlık yoksa null', () => {
    expect(parseFrontmatter('düz metin')).toBeNull();
  });

  it('safeSkillPath: klasör dışına çıkan/mutlak/gizli kalıpları reddeder', () => {
    for (const ok of ['references/a.md', 'scripts/run.py', 'x.txt']) expect(safeSkillPath(ok)).toBe(true);
    for (const bad of ['../x', '/etc/passwd', 'a/../b', 'a//b', 'a\\b', './a', '']) expect(safeSkillPath(bad)).toBe(false);
  });
});

const cat: SkillSummary[] = [
  { name: 'static-web-app', description: 'Build single-page web apps and browser games with HTML, CSS and JavaScript files and preview them.', source: 'builtin', triggers: ['oyun', 'game', 'web sayfası', 'html', 'canvas', 'tarayıcı'] },
  { name: 'debugging', description: 'Systematically find and fix a bug: reproduce, isolate, fix, verify.', source: 'builtin', triggers: ['hata', 'bug', 'çalışmıyor', 'exception', 'crash'] },
  { name: 'write-tests', description: 'Add unit tests with the project test framework.', source: 'builtin', triggers: ['test', 'birim testi', 'vitest', 'jest', 'pytest'] },
  { name: 'data-analysis', description: 'Analyze CSV or JSON data with Python and share charts.', source: 'builtin', triggers: ['csv', 'veri', 'analiz', 'grafik', 'pandas'] },
];

describe('skill eşleştirme', () => {
  it('Türkçe istek, İngilizce açıklamalı skill\'e tetikleyiciyle eşleşir (diyakritik ve ek toleransı)', () => {
    expect(matchSkills(cat, 'Tarayıcıda yılan oyunu yapar mısın?')[0]?.name).toBe('static-web-app');
    expect(matchSkills(cat, 'Giriş ekranı çalışmıyor, hata veriyor')[0]?.name).toBe('debugging');
    expect(matchSkills(cat, 'bu csv dosyasının grafiğini çıkar')[0]?.name).toBe('data-analysis');
    expect(matchSkills(cat, 'login için birim testleri ekle')[0]?.name).toBe('write-tests');
  });
  it('alakasız istek ve boş katalogda boş döner; en çok `max` skill', () => {
    expect(matchSkills(cat, 'merhaba nasılsın')).toEqual([]);
    expect(matchSkills([], 'oyun yap')).toEqual([]);
    expect(matchSkills(cat, 'oyun hata test csv', 2)).toHaveLength(2);
  });
});
