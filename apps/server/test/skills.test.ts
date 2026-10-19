import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseSkillMd, type SkillSummary } from '@sixfinger/shared';
import { loadConfig } from '../src/config.ts';
import type { AiChunk } from '../src/services/ai.ts';
import { SKILL_MARK, pruneToolResults } from '../src/services/code-context.ts';
import { activeSkillsSection, buildCodeSystemPrompt, skillsSection } from '../src/services/code-prompt.ts';
import { buildCatalog, createSkillRuntime, createSkills, discoverRepoSkills, loadBuiltinSkills, validateSkillFiles, type SkillBundle } from '../src/services/skills.ts';
import { createSkillTool } from '../src/services/tools/skills.ts';
import { createGithub } from '../src/services/github.ts';
import { auth, member, resetDb, setup, type TestEnv } from './helpers.ts';
import { fakeCode } from './fake-code.ts';

const mk = (name: string, description: string, body: string, source: SkillSummary['source'] = 'builtin', triggers: string[] = [], files: Record<string, string> = {}): SkillBundle => ({
  summary: { name, description, source, triggers },
  body,
  files,
});

describe('yerleşik skill yükleme', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-skills-'));
    mkdirSync(join(dir, 'iyi', 'references'), { recursive: true });
    mkdirSync(join(dir, 'iyi', 'scripts'));
    writeFileSync(join(dir, 'iyi', 'SKILL.md'), '---\nname: iyi\ndescription: Çalışan skill. Use when testing.\ntriggers: [deneme, test]\n---\n\n# İyi\n\nAdım 1.\n');
    writeFileSync(join(dir, 'iyi', 'references', 'api.md'), '# API\n');
    writeFileSync(join(dir, 'iyi', 'scripts', 'run.py'), "print('ok')\n");
    mkdirSync(join(dir, 'bozuk'));
    writeFileSync(join(dir, 'bozuk', 'SKILL.md'), 'başlık yok');
    mkdirSync(join(dir, 'kotu-yol'));
    writeFileSync(join(dir, 'kotu-yol', 'SKILL.md'), '---\nname: kotu-yol\ndescription: x\n---\n\ngövde');
    writeFileSync(join(dir, 'kotu-yol', 'ikili.bin'), Buffer.from([0, 1, 2]));
    mkdirSync(join(dir, 'dosyasiz-klasor'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('geçerli skill gövde, ek dosya ve tetikleyicilerle yüklenir; bozuklar atlanıp bildirilir', () => {
    const errs: string[] = [];
    const m = loadBuiltinSkills(dir, (n, msg) => errs.push(`${n}: ${msg}`));
    expect([...m.keys()]).toEqual(['iyi']);
    const s = m.get('iyi')!;
    expect(s.summary).toMatchObject({ source: 'builtin', triggers: ['deneme', 'test'] });
    expect(s.body).toContain('Adım 1.');
    expect(Object.keys(s.files).sort()).toEqual(['references/api.md', 'scripts/run.py']);
    expect(errs.some((e) => e.startsWith('bozuk:'))).toBe(true);
    expect(errs.some((e) => e.startsWith('kotu-yol:'))).toBe(true);
  });
  it('olmayan klasörde boş harita', () => {
    expect(loadBuiltinSkills(join(dir, 'yok')).size).toBe(0);
  });
  it('validateSkillFiles: yol, boyut, sayı, ikili', () => {
    expect(validateSkillFiles({ 'a.md': 'x' })).toBeNull();
    expect(validateSkillFiles({ '../a': 'x' })).toContain('Geçersiz');
    expect(validateSkillFiles({ 'SKILL.md': 'x' })).toContain('Geçersiz');
    expect(validateSkillFiles({ 'a.bin': 'x\u0000' })).toContain('metin');
    expect(validateSkillFiles({ 'a.md': 'x'.repeat(50_001) })).toContain('50000');
    expect(validateSkillFiles(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}.md`, 'x'])))).toContain('20');
  });
});

describe('katalog', () => {
  it('öncelik repo > kullanıcı > yerleşik; ortamda kapatılanlar çıkar; ada göre sıralı', () => {
    const builtin = new Map([mk('b', 'yerleşik b', 'B-yerleşik'), mk('a', 'yerleşik a', 'A'), mk('c', 'yerleşik c', 'C')].map((x) => [x.summary.name, x]));
    const user = [{ ...mk('b', 'kullanıcı b', 'B-kullanıcı', 'user'), shareToken: null, importedFrom: null, updatedAt: '' }];
    const repo = [{ summary: { name: 'b', description: 'repo b', source: 'repo' as const, triggers: [] }, repoDir: '.claude/skills/b' }];
    const c = buildCatalog({ builtin, user, repo, off: ['c'] });
    expect(c.list.map((s) => `${s.name}:${s.source}`)).toEqual(['a:builtin', 'b:repo']);
    expect(buildCatalog({ builtin, user, repo: [], off: [] }).get('b')?.bundle?.body).toBe('B-kullanıcı');
    expect(c.get('c')).toBeUndefined();
  });
});

describe('repo skill keşfi ve yükleyici', () => {
  const REPO_OUT = [
    '@@SKILL .claude/skills/deploy/SKILL.md',
    '---\nname: deploy\ndescription: Deploy the app with our script. Use for releases.\ntriggers: [yayın, release]\n---\n\n# Deploy\nÖnce testleri çalıştır.\n',
    '@@SKILL .sixfinger/skills/lint-fix/SKILL.md',
    '---\ndescription: Fix lint errors\n---\n\nrun eslint --fix',
    '@@SKILL .agents/skills/Kötü Ad/SKILL.md',
    '---\nname: Kötü Ad\ndescription: x\n---\n\ng',
    '@@SKILL .claude/skills/deploy2/SKILL.md',
    '---\nname: deploy\ndescription: aynı ad, ikincisi yok sayılır\n---\n\ng',
  ].join('\n');
  const scope = { user: 'u', session: 'u:c' };

  it('discoverRepoSkills: ad klasörden de gelir, geçersiz/yinelenen adlar atlanır, tetikleyiciler okunur', async () => {
    const fc = fakeCode();
    fc.state.execImpl = (c) => (c.includes('.claude/skills') ? { stdout: REPO_OUT } : {});
    const found = await discoverRepoSkills(fc.client, scope, new AbortController().signal);
    expect(found.map((f) => `${f.summary.name}@${f.repoDir}`)).toEqual(['deploy@.claude/skills/deploy', 'lint-fix@.sixfinger/skills/lint-fix']);
    expect(found[0]!.summary.triggers).toEqual(['yayın', 'release']);
    expect(found[0]!.summary.source).toBe('repo');
  });

  it('keşif hatasında boş liste (sandbox erişilemezse tur bozulmaz)', async () => {
    const fc = fakeCode();
    fc.client.exec = async () => {
      throw new Error('boom');
    };
    expect(await discoverRepoSkills(fc.client, scope, new AbortController().signal)).toEqual([]);
  });

  it('runtime.load: yerleşik gövde + dosya listesi + betikler çalışma alanına açılır; yüklenenler izlenir', async () => {
    const fc = fakeCode();
    const b = mk('veri', 'Veri analizi', '# Veri\n1. csv oku', 'builtin', [], { 'references/pandas.md': 'ipuçları', 'scripts/stats.py': "print('x')\n" });
    const rt = createSkillRuntime(buildCatalog({ builtin: new Map([[b.summary.name, b]]), user: [], repo: [], off: [] }), fc.client, scope);
    const sig = new AbortController().signal;
    const r = await rt.load('veri', undefined, sig);
    expect(r.text.startsWith(SKILL_MARK)).toBe(true);
    expect(r.text).toContain('# Veri');
    expect(r.text).toContain('references/pandas.md, scripts/stats.py');
    expect(r.text).toContain('.sixfinger/run/skills/veri/scripts/stats.py');
    expect(fc.fs.get('.sixfinger/run/skills/veri/scripts/stats.py')).toBe("print('x')\n");
    expect(fc.fs.has('.sixfinger/run/skills/veri/references/pandas.md')).toBe(false);
    expect(rt.loaded.get('veri')?.body).toBe('# Veri\n1. csv oku');
    // ek dosya
    expect((await rt.load('veri', 'references/pandas.md', sig)).text).toContain('ipuçları');
    await expect(rt.load('veri', 'yok.md', sig)).rejects.toThrow('no file');
    await expect(rt.load('veri', '../x', sig)).rejects.toThrow('Invalid skill file path');
    // bilinmeyen: yakın öneri + liste
    await expect(rt.load('ver', undefined, sig)).rejects.toThrow(/Did you mean: veri/);
    await expect(rt.load('xyz', undefined, sig)).rejects.toThrow('Available skills: veri');
  });

  it('runtime.load: repo skill\'i çalışma alanından okunur; güven notu eklenir; dosyalar listelenir', async () => {
    const fc = fakeCode({ '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: d\n---\n\n# Deploy\nadım', '.claude/skills/deploy/scripts/go.sh': 'echo go' });
    fc.state.execImpl = (c) => (c.includes('find .') ? { stdout: 'scripts/go.sh\n' } : {});
    const repo = [{ summary: { name: 'deploy', description: 'd', source: 'repo' as const, triggers: [] }, repoDir: '.claude/skills/deploy' }];
    const rt = createSkillRuntime(buildCatalog({ builtin: new Map(), user: [], repo, off: [] }), fc.client, scope);
    const r = await rt.load('deploy', undefined, new AbortController().signal);
    expect(r.text).toContain('# Deploy');
    expect(r.text).toContain('comes from the repository');
    expect(r.text).toContain('scripts/go.sh');
    expect((await rt.load('deploy', 'scripts/go.sh', new AbortController().signal)).text).toContain('echo go');
    expect(await rt.peekBody('deploy', new AbortController().signal)).toContain('# Deploy');
  });

  it('skill aracı: argüman doğrulama, boş katalog ve meta verisi', async () => {
    const fc = fakeCode();
    const b = mk('x-skill', 'X', 'gövde');
    const rt = createSkillRuntime(buildCatalog({ builtin: new Map([['x-skill', b]]), user: [], repo: [], off: [] }), fc.client, scope);
    const tool = createSkillTool(rt);
    const ctx = { user: { id: 'u' } as never, signal: new AbortController().signal };
    const ok = await tool.run({ name: 'X-Skill' }, ctx);
    expect(ok.output).toContain('gövde');
    expect(ok.meta).toMatchObject({ name: 'x-skill', source: 'builtin' });
    await expect(tool.run({}, ctx)).rejects.toThrow('Invalid arguments for tool "skill"');
    const empty = createSkillTool(createSkillRuntime(buildCatalog({ builtin: new Map(), user: [], repo: [], off: [] }), fc.client, scope));
    await expect(empty.run({ name: 'a' }, ctx)).rejects.toThrow('no skills');
  });
});

describe('istem ve bağlam', () => {
  const sum = (name: string, description: string, source: SkillSummary['source'] = 'builtin'): SkillSummary => ({ name, description, source, triggers: [] });

  it('skills bölümü: kurallar, kaynak etiketleri, ipucu; skill yoksa bölüm yok; çok skill\'de açıklamalar kısalır adlar kalır', () => {
    expect(skillsSection([])).toEqual([]);
    const txt = skillsSection([sum('a', 'Builtin one'), sum('b', 'Repo one', 'repo'), sum('c', 'Mine', 'user')], ['a']).join('\n');
    expect(txt).toContain('call skill with its name FIRST');
    expect(txt).toContain('- a: Builtin one');
    expect(txt).toContain('- b [repo]: Repo one');
    expect(txt).toContain('- c [yours]: Mine');
    expect(txt).toContain('looks related to: a');
    const many = Array.from({ length: 60 }, (_, i) => sum(`skill-${i}`, 'd'.repeat(400)));
    const big = skillsSection(many).join('\n');
    expect(big.length).toBeLessThan(11_500);
    for (let i = 0; i < 60; i++) expect(big).toContain(`- skill-${i}:`);
  });

  it('buildCodeSystemPrompt: katalog ve aktif skill gövdeleri istemde; aktif olanlar 3 ile sınırlı ve kırpılır', () => {
    const base = { locale: 'en' as const, repo: 'a/b', baseBranch: 'main', workBranch: 'w', network: 'none' as const, allowedDomains: [], diskMb: 512 };
    const p = buildCodeSystemPrompt({ ...base, skills: [sum('web', 'Web apps')], skillHints: ['web'], activeSkills: [{ name: 'web', body: 'TALİMAT-GÖVDESİ' }] });
    expect(p).toContain('## Skills');
    expect(p).toContain('## Active skills');
    expect(p).toContain('TALİMAT-GÖVDESİ');
    expect(buildCodeSystemPrompt(base)).not.toContain('## Skills');
    const act = activeSkillsSection([1, 2, 3, 4].map((n) => ({ name: `s${n}`, body: 'b'.repeat(7_000) }))).join('\n');
    expect(act).not.toContain('### s1');
    expect(act).toContain('### s4');
    expect(act).toContain('trimmed');
  });

  it('bağlam kırpma: son 3 skill sonucu olduğu gibi kalır, eskileri ve diğer eski araç sonuçları kırpılır', () => {
    const big = (tag: string) => `${tag}\n${'x'.repeat(5_000)}`;
    const msgs = [{ role: 'system' as const, content: 's' }];
    for (let i = 0; i < 5; i++) msgs.push({ role: 'tool' as const, content: big(`${SKILL_MARK}s${i}]`) } as never);
    for (let i = 0; i < 12; i++) msgs.push({ role: 'tool' as const, content: big(`out${i}`) } as never);
    const out = pruneToolResults(msgs, { keepRecent: 4, trimTo: 300, budgetTokens: 1_000_000 });
    const skillOut = out.filter((m) => m.content.startsWith(SKILL_MARK));
    expect(skillOut.map((m) => m.content.length > 4_000)).toEqual([false, false, true, true, true]);
    expect(out.slice(6, 14).every((m) => m.content.length < 600)).toBe(true);
  });
});

describe('ajan döngüsünde skill\'ler', () => {
  let env: TestEnv;
  let fc: ReturnType<typeof fakeCode>;
  const call = (id: string, name: string, args: object): AiChunk => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const text = (t: string): AiChunk[] => [{ type: 'content', text: t }];
  const WEB = mk('static-web-app', 'Build browser games and web pages from HTML, CSS and JavaScript files.', 'KURAL-1: göreli URL kullan.\nKURAL-2: preview çağır.', 'builtin', ['oyun', 'game', 'web sayfası'], { 'references/canvas.md': 'canvas ipuçları' });
  const TEST = mk('write-tests', 'Add unit tests.', 'testleri yaz', 'builtin', ['test']);

  async function boot(builtin: SkillBundle[] = [WEB, TEST]) {
    fc = fakeCode({ 'app.js': 'console.log(1);\n' });
    const config = loadConfig();
    const db = undefined as never;
    void db;
    env = await setup([], { code: fc.client }, { config, codeSandbox: fc.client, github: createGithub(config, (async () => new Response('{}')) as unknown as typeof fetch) });
    env.ctx.skills.builtin.clear();
    for (const b of builtin) env.ctx.skills.builtin.set(b.summary.name, b);
    await resetDb(env.ctx);
  }
  async function prepared(email = 'coder@example.com') {
    const a = await member(env, { email });
    await env.ctx.code.saveConnection(a.user.id, { id: 42, login: 'octo', avatarUrl: '' }, 'gho_testtoken', 'repo');
    const s = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
    await env.ctx.db.query('update code_environments set auto_pr = false where user_id = $1', [a.user.id]);
    return { a, s };
  }
  const send = (a: Awaited<ReturnType<typeof member>>, chatId: string, content: string) => env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content } });
  const sysOf = (i: number) => String(env.ai.calls.filter((c) => c.route === 'code' && c.effort !== 'low')[i]!.messages[0]!.content);
  const toolNames = (i: number) => env.ai.calls.filter((c) => c.route === 'code' && c.effort !== 'low')[i]!.tools?.map((t) => t.function.name) ?? [];

  beforeEach(async () => {
    if (env) await env.app.close();
    await boot();
  });
  afterAll(async () => {
    await env?.app.close();
  });

  it('katalog istemde, skill aracı açık; mesaj eşleşirse ipucu eklenir; alakasızsa eklenmez', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [text('Yaptım.')];
    await send(a, s.chatId, 'Tarayıcıda yılan oyunu yapar mısın?');
    expect(sysOf(0)).toContain('- static-web-app:');
    expect(sysOf(0)).toContain('- write-tests: Add unit tests.');
    expect(sysOf(0)).toContain('looks related to: static-web-app');
    expect(toolNames(0)).toContain('skill');
    env.ai.calls.length = 0;
    env.ai.steps = [text('Merhaba.')];
    await send(a, s.chatId, 'nasılsın');
    expect(sysOf(0)).not.toContain('looks related to');
  });

  it('skill çağrısı gövdeyi ve dosya listesini döndürür; kart meta verisi (ad, kaynak) taşır; hata modele açıklanır', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('k1', 'skill', { name: 'static-web-app' })], [call('k2', 'skill', { name: 'static-web-app', file: 'references/canvas.md' })], [call('k3', 'skill', { name: 'olmayan' })], text('Tamam.')];
    await send(a, s.chatId, 'oyun yap');
    const d = (await env.app.inject({ method: 'GET', url: `/api/chats/${s.chatId}`, headers: auth(a) })).json();
    const parts = ([...d.messages].reverse().find((m: { role: string }) => m.role === 'assistant').parts as Array<{ name?: string; status?: string; output?: string; meta?: Record<string, unknown> }>).filter((p) => p.name === 'skill');
    expect(parts.map((p) => p.status)).toEqual(['done', 'done', 'error']);
    expect(parts[0]!.output).toContain('KURAL-1');
    expect(parts[0]!.output).toContain('references/canvas.md');
    expect(parts[0]!.meta).toMatchObject({ name: 'static-web-app', source: 'builtin' });
    expect(parts[1]!.output).toContain('canvas ipuçları');
    expect(parts[2]!.output).toContain('Available skills: static-web-app, write-tests');
    // sonraki modele giden tool sonucu skill gövdesini içerir
    const third = env.ai.calls.filter((c) => c.route === 'code' && c.effort !== 'low')[1]!;
    expect(third.messages.some((m) => m.role === 'tool' && m.content.startsWith('[skill:static-web-app]') && m.content.includes('KURAL-2'))).toBe(true);
  });

  it('sonraki turda önceki turda yüklenen skill istemde "Active skills" olarak kalır', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('k1', 'skill', { name: 'static-web-app' })], text('Bitti.')];
    await send(a, s.chatId, 'oyun yap');
    env.ai.calls.length = 0;
    env.ai.steps = [text('Devam.')];
    await send(a, s.chatId, 'şimdi rengini değiştir');
    expect(sysOf(0)).toContain('## Active skills');
    expect(sysOf(0)).toContain('KURAL-2: preview çağır.');
  });

  it('ortamda kapatılan skill katalogda yok; hiç skill kalmazsa araç ve bölüm yok', async () => {
    const { a, s } = await prepared();
    await env.ctx.db.query(`update code_environments set skills_off = array['write-tests'] where user_id = $1`, [a.user.id]);
    env.ai.steps = [text('x')];
    await send(a, s.chatId, 'merhaba');
    expect(sysOf(0)).toContain('- static-web-app:');
    expect(sysOf(0)).not.toContain('- write-tests:');
    await env.ctx.db.query(`update code_environments set skills_off = array['write-tests', 'static-web-app'] where user_id = $1`, [a.user.id]);
    env.ai.calls.length = 0;
    env.ai.steps = [text('y')];
    await send(a, s.chatId, 'merhaba');
    expect(sysOf(0)).not.toContain('## Skills');
    expect(toolNames(0)).not.toContain('skill');
  });

  it('kullanıcı skill\'i yerleşiğin üstüne yazar; repo skill\'i hepsinin üstüne yazar', async () => {
    const { a, s } = await prepared();
    await env.ctx.skills.store.save(a.user.id, { name: 'write-tests', description: 'Kullanıcının test kuralları', triggers: [], body: 'kendi gövdem', extra: {} }, {});
    fc.state.execImpl = (c) => (c.includes('.claude/skills') ? { stdout: '@@SKILL .claude/skills/write-tests/SKILL.md\n---\nname: write-tests\ndescription: Repo test rules\n---\n\nrepo gövdesi\n' } : {});
    env.ai.steps = [text('x')];
    await send(a, s.chatId, 'merhaba');
    expect(sysOf(0)).toContain('- write-tests [repo]: Repo test rules');
    expect(sysOf(0)).not.toContain('Kullanıcının test kuralları');
  });

  it('komut listesi skill\'leri slash komutu olarak içerir (yerleşik adlar hariç)', async () => {
    const { a, s } = await prepared();
    await env.ctx.skills.store.save(a.user.id, { name: 'review', description: 'builtin adıyla çakışır', triggers: [], body: 'x', extra: {} }, {});
    const r = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/commands`, headers: auth(a) });
    const cmds = r.json().commands as Array<{ name: string; source: string; template?: string }>;
    const web = cmds.find((c) => c.name === 'static-web-app');
    expect(web).toMatchObject({ source: 'skill' });
    expect(web!.template).toContain('call the skill tool first');
    expect(cmds.filter((c) => c.name === 'review')).toHaveLength(0);
  });
});

describe('skill paketi içeriği', () => {
  it('SKILL.md dosyaları geçerli: parseSkillMd kabul eder (gerçek yerleşikler 6.3\'te eklenir)', () => {
    const m = createSkills({ db: undefined as never }).builtin;
    for (const b of m.values()) expect(parseSkillMd(`---\nname: ${b.summary.name}\ndescription: ${b.summary.description}\n---\n\n${b.body}`).ok).toBe(true);
  });
});
