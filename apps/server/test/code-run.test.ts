import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sixfinger/shared';
import { loadConfig } from '../src/config.ts';
import type { AiChunk } from '../src/services/ai.ts';
import { createGithub } from '../src/services/github.ts';
import { auth, member, parseSse, resetDb, setup, type TestEnv } from './helpers.ts';
import { fakeCode } from './fake-code.ts';
import { SUMMARIZER_PROMPT, SUMMARY_HEADER } from '../src/services/code-context.ts';

type Fake = ReturnType<typeof fakeCode>;
let env: TestEnv;
let fc: Fake;

const call = (id: string, name: string, args: object): AiChunk => ({ type: 'tool_calls', calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const text = (t: string): AiChunk[] => [{ type: 'content', text: t }];

async function boot(over: Record<string, unknown> = {}, files: Record<string, string> = { 'app.js': 'console.log(1);\n' }) {
  fc = fakeCode(files);
  const config = { ...loadConfig(), ...over } as ReturnType<typeof loadConfig>;
  env = await setup([], { code: fc.client }, { config, codeSandbox: fc.client, github: createGithub(config, (async () => new Response('{}')) as unknown as typeof fetch) });
}

/** Doğrulanmış, izinli, GitHub'a bağlı bir kullanıcı ve bir Code oturumu. */
async function prepared(email = 'coder@example.com') {
  const a = await member(env, { email });
  await env.ctx.code.saveConnection(a.user.id, { id: 42, login: 'octo', avatarUrl: '' }, 'gho_testtoken', 'repo');
  const s = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
  return { a, s };
}

async function send(a: Awaited<ReturnType<typeof member>>, chatId: string, content: string) {
  const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content } });
  return { status: r.statusCode, events: r.statusCode === 200 ? parseSse(r.body) : ([] as StreamEvent[]), body: r.body };
}
const detail = async (a: Awaited<ReturnType<typeof member>>, chatId: string) => (await env.app.inject({ method: 'GET', url: `/api/chats/${chatId}`, headers: auth(a) })).json();
const of = <T extends StreamEvent['type']>(events: StreamEvent[], type: T) => events.filter((e) => e.type === type) as Array<Extract<StreamEvent, { type: T }>>;
/** Ajan turlarının model istekleri (başlık/commit için yapılan yardımcı çağrılar hariç). */
const agentCalls = () => env.ai.calls.filter((c) => c.route === 'code' && c.effort !== 'low');
const lastAssistant = (d: { messages: Array<{ role: string; parts: Array<Record<string, unknown>>; content: string; status: string }> }) => [...d.messages].reverse().find((m) => m.role === 'assistant')!;

beforeAll(async () => {
  await boot();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await env.app.close();
  await boot();
  await resetDb(env.ctx);
});

describe('Code ajan döngüsü: mutlu yol', () => {
  it('yaz → çalıştır → yanıtla; araç meta verisi, commit, değişiklik özeti, kredi ve başlık', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [
      [{ type: 'reasoning', text: 'Önce dosyayı yazayım.' }, call('c1', 'write', { path: 'hello.js', content: "console.log('merhaba');\n" })],
      [call('c2', 'bash', { command: 'node hello.js' })],
      text('Tamam: hello.js oluşturuldu ve çalıştırıldı.'),
    ];
    fc.state.execImpl = (c) => (c.startsWith('node hello.js') ? { stdout: 'merhaba\n', durationMs: 90 } : c.startsWith('ls -1Ap') ? { stdout: 'app.js\nREADME.md\n' } : {});
    env.ai.completeText = 'feat: merhaba betiği ekle.';
    const r = await send(a, s.chatId, 'hello.js yaz ve çalıştır');
    expect(r.status).toBe(200);

    const phases = of(r.events, 'phase').map((p) => p.phase);
    expect(phases).toEqual(['queued', 'preparing', 'working', 'committing']);
    const tools = of(r.events, 'tool_end');
    expect(tools.map((t) => t.status)).toEqual(['done', 'done', 'done', 'done']); // workspace, write, bash, commit
    expect(tools[1]!.meta).toEqual({ files: [{ path: 'hello.js', additions: 1, deletions: 0, status: 'added' }] });
    expect(tools[2]!.meta).toMatchObject({ exitCode: 0, command: 'node hello.js' });
    expect(of(r.events, 'context').length).toBe(3);
    expect(of(r.events, 'changes')[0]).toMatchObject({ files: 1, additions: 1, deletions: 0 });
    expect(of(r.events, 'title')).toHaveLength(1);

    // sandbox çağrıları: kimlik, token yalnızca prepare'da, yazar kullanıcı
    expect(fc.state.prepares).toHaveLength(1);
    expect(fc.state.prepares[0]).toMatchObject({ repo: 'octo/alpha', baseBranch: 'main', token: 'gho_testtoken', author: { name: 'octo', email: '42+octo@users.noreply.github.com' }, network: { mode: 'trusted' }, diskMb: 512 });
    expect(fc.fs.get('hello.js')).toBe("console.log('merhaba');\n");

    // commit mesajı: başlık temizlenir, ortak yazar HER ZAMAN var, oturum bağlantısı yok (varsayılan)
    expect(fc.state.commits).toHaveLength(1);
    expect(fc.state.commits[0]).toMatch(/^feat: merhaba betiği ekle\n\n- hello\.js \(\+1 −0\)\n\nCo-Authored-By: SixFinger Code <noreply@sixfinger\.live>$/);

    // kalıcı mesaj: parçalar sırayla ve sahte araçlar dahil
    const d = await detail(a, s.chatId);
    const m = lastAssistant(d);
    expect(m.status).toBe('complete');
    expect(m.parts.filter((p) => p.type === 'tool').map((p) => p.name)).toEqual(['workspace', 'write', 'bash', 'commit']);
    expect(m.parts.find((p) => p.name === 'commit')).toMatchObject({ summary: expect.stringMatching(/^[0-9a-f]{7}$/), meta: { files: 1 } });
    expect(m.content).toContain('hello.js oluşturuldu');
    expect(d.chat.title).not.toBe('Yeni oturum');

    // oturum durumu ve istatistikleri
    const sess = (await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}`, headers: auth(a) })).json().session;
    expect(sess).toMatchObject({ status: 'idle', additions: 1, filesChanged: 1, contextLimit: 262_144 });
    expect(sess.contextTokens).toBeGreaterThan(500);
    expect(sess.headSha).toMatch(/^c+/);

    // kredi harcandı, sohbet günlük hakkı harcanmadı
    expect((await env.ctx.code.credits(a.user.id)).used).toBeGreaterThan(0);
    expect((await env.ctx.usage.get(a.user.id, a.user.tier)).used).toBe(0);
  });

  it('model Code zincirini kullanır ve araç listesi Code araçlarıdır', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [text('Merhaba.')];
    fc.state.execImpl = (c) => (c.startsWith('ls -1Ap') ? { stdout: 'app.js\nREADME.md\n' } : {});
    await send(a, s.chatId, 'selam');
    fc.state.execImpl = (c) => (c.startsWith('ls -1Ap') ? { stdout: 'app.js\nREADME.md\n' } : {});
    const req = agentCalls()[0]!;
    expect(req.route).toBe('code');
    expect(req.tools?.map((t) => t.function.name)).toEqual(['bash', 'read', 'write', 'edit', 'glob', 'grep', 'todo', 'web_search', 'web_fetch']);
    const system = req.messages[0]!.content;
    expect(system).toContain('SixFinger Code');
    expect(system).toContain('octo/alpha');
    expect(system).toContain('app.js'); // çalışma alanı özeti (ls) sistem istemine girer
  });

  it('commit mesajına oturum bağlantısı ortam ayarına bağlıdır', async () => {
    const { a, s } = await prepared();
    const envId = (await env.ctx.code.listEnvironments(a.user.id))[0]!.id;
    await env.ctx.code.updateEnvironment(a.user.id, envId, { commitSessionLink: true });
    env.ai.steps = [[call('c1', 'write', { path: 'x.txt', content: 'x\n' })], text('Bitti.')];
    await send(a, s.chatId, 'x yaz');
    expect(fc.state.commits[0]).toContain(`SixFinger-Session: http://localhost:5173/code/s/${s.chatId}`);
    expect(fc.state.commits[0]).toContain('Co-Authored-By: SixFinger Code');
  });

  it('değişiklik yoksa commit atılmaz', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [text('Bir şey değiştirmeye gerek yok.')];
    const r = await send(a, s.chatId, 'bu ne yapıyor?');
    expect(fc.state.commits).toEqual([]);
    expect(of(r.events, 'changes')[0]).toMatchObject({ files: 0, sha: null });
    expect(lastAssistant(await detail(a, s.chatId)).parts.some((p) => p.name === 'commit')).toBe(false);
  });

  it('ikinci mesajda sahte araçlar (workspace/commit) modele geri verilmez; bir sonraki tur aynı çalışma alanını yeniden hazırlar', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('c1', 'write', { path: 'x.txt', content: 'x\n' })], text('İlk iş bitti.')];
    await send(a, s.chatId, 'bir');
    env.ai.calls.length = 0;
    env.ai.steps = [text('İkinci.')];
    await send(a, s.chatId, 'iki');
    const names = agentCalls()[0]!.messages.flatMap((m) => m.tool_calls?.map((t) => t.function.name) ?? []);
    expect(names).toEqual(['write']);
    expect(fc.state.prepares).toHaveLength(2);
    expect(fc.state.prepares[1]).not.toHaveProperty('cloneUrl');
  });
});

describe('Code ajan döngüsü: güvenlik ve sınırlar', () => {
  it('adım sınırı YOK: 90 farklı araç turu kesilmeden sürer ve her turda araçlar açıktır', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [...Array.from({ length: 90 }, (_, i) => [call(`c${i}`, 'bash', { command: `echo adım ${i}` })]), text('Hepsi bitti.')];
    fc.state.execImpl = (c) => ({ stdout: `${c}\n` });
    const r = await send(a, s.chatId, 'çok uzun bir iş');
    const reqs = agentCalls();
    expect(reqs).toHaveLength(91);
    expect(reqs.every((q) => q.tools?.length)).toBe(true);
    expect(reqs.some((q) => q.messages.some((m) => /maximum number of tool steps/.test(m.content)))).toBe(false);
    const m = lastAssistant(await detail(a, s.chatId));
    expect(m.content).toBe('Hepsi bitti.');
    expect(m.status).toBe('complete');
    expect(r.events.some((e) => e.type === 'done')).toBe(true);
  }, 60_000);

  it('döngü kırıcı: aynı çağrı aynı sonucu 3. kez verirse uyarı, 5. kezde durur', async () => {
    await boot();
    const { a, s } = await prepared();
    env.ai.steps = Array.from({ length: 8 }, (_, i) => [call(`c${i}`, 'bash', { command: 'npm test' })]);
    fc.state.execImpl = (c) => (c === 'npm test' ? { stdout: 'FAIL: aynı hata\n', exitCode: 1 } : {});
    const r = await send(a, s.chatId, 'testleri düzelt');
    const outs = of(r.events, 'tool_end').filter((t) => t.output.includes('npm test'));
    expect(outs).toHaveLength(5); // 5. çağrıdan sonra durur
    expect(outs[1]!.output).not.toMatch(/Warning/);
    expect(outs[2]!.output).toMatch(/Warning: this exact call has produced this exact result 3 times/);
    const m = lastAssistant(await detail(a, s.chatId));
    expect(m.content).toContain('tekrarlayıp ilerleyemediğim');
    expect(agentCalls()).toHaveLength(5);
  });

  it('farklı çıktı veren tekrarlar (test → düzelt → test) döngü sayılmaz', async () => {
    const { a, s } = await prepared();
    let n = 0;
    fc.state.execImpl = (c) => (c === 'npm test' ? { stdout: `çıktı ${++n}\n`, exitCode: n < 4 ? 1 : 0 } : {});
    env.ai.steps = [...Array.from({ length: 4 }, (_, i) => [call(`c${i}`, 'bash', { command: 'npm test' })]), text('Geçti.')];
    const r = await send(a, s.chatId, 'testleri çalıştır');
    expect(of(r.events, 'tool_end').filter((t) => /Warning/.test(t.output))).toHaveLength(0);
    expect(lastAssistant(await detail(a, s.chatId)).content).toBe('Geçti.');
  });

  it('çıktı sınırına takılırsa en çok 2 kez "devam et" notu eklenir, sonra durur', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[{ type: 'truncated' }, ...text('yarım…')], [{ type: 'truncated' }, ...text('yine yarım…')], [{ type: 'truncated' }, ...text('hâlâ yarım…')]];
    const r = await send(a, s.chatId, 'büyük iş');
    const reqs = agentCalls();
    expect(reqs).toHaveLength(3);
    expect(reqs[1]!.messages.at(-1)!.content).toMatch(/cut off by the output length limit/);
    expect(lastAssistant(await detail(a, s.chatId)).content).toContain('uzunluk sınırına takıldığı');
    expect(r.events.some((e) => e.type === 'done')).toBe(true);
  });

  it('günlük kredi bittiyse hiçbir şey çalıştırılmaz (429)', async () => {
    const { a, s } = await prepared();
    await env.ctx.db.query(`insert into code_credit_daily (user_id, day, credits) values ($1, (now() at time zone 'Europe/Istanbul')::date, 100)`, [a.user.id]);
    const r = await send(a, s.chatId, 'iş');
    expect(of(r.events, 'error')[0]).toMatchObject({ code: 'quota_exceeded' });
    expect(fc.state.prepares).toHaveLength(0);
    expect(env.ai.calls).toHaveLength(0);
    expect((await env.ctx.code.getSession(a.user.id, s.chatId))!.status).toBe('error');
  });

  it('kredi çalışırken biterse tur kendiliğinden durur, o ana kadarki iş commit edilir', async () => {
    await boot({ CODE_DAILY_CREDITS: 1 });
    const { a, s } = await prepared();
    await env.ctx.db.query(`insert into code_credit_daily (user_id, day, credits) values ($1, (now() at time zone 'Europe/Istanbul')::date, 0.999)`, [a.user.id]);
    env.ai.steps = [[call('c1', 'write', { path: 'p.txt', content: 'p\n' })], [call('c2', 'bash', { command: 'echo 2' })], text('asla gelmez')];
    await send(a, s.chatId, 'iş');
    expect(fc.fs.get('p.txt')).toBe('p\n');
    expect(fc.state.commits).toHaveLength(1);
    expect(lastAssistant(await detail(a, s.chatId)).content).toContain('Günlük Code kredin bitti');
    expect(agentCalls().length).toBeLessThan(3);
  });

  it('bağlam dolunca eski konuşma özetlenir; özet sonraki turun geçmişine girer, kırpma yetmeyince öylece kesilmez', async () => {
    await boot({ CODE_CONTEXT_TOKENS: 8_000 });
    const { a, s } = await prepared();
    fc.state.execImpl = (c) => (c.startsWith('gen') ? { stdout: 'x'.repeat(9_000) } : {});
    env.ai.completeText = 'GOAL: büyük çıktıları üret. DONE: gen 0..N çalıştırıldı.';
    env.ai.steps = [...Array.from({ length: 14 }, (_, i) => [call(`c${i}`, 'bash', { command: `gen ${i}` })]), text('bitti')];
    const r = await send(a, s.chatId, 'bol çıktı üret');
    expect(of(r.events, 'error')).toHaveLength(0);

    const d = await detail(a, s.chatId);
    const last = lastAssistant(d);
    expect(last.content).toContain('bitti');
    const comp = (last.parts as Array<Record<string, any>>).filter((p) => p.name === 'compaction');
    expect(comp.length).toBeGreaterThan(0);
    expect(comp[0]).toMatchObject({ status: 'done', meta: { keepUser: false } });
    expect(comp[0]!.output).toContain('GOAL: büyük çıktıları üret');
    expect(comp[0]!.output).toContain('bol çıktı üret'); // kullanıcının isteği özetin yanında taşınır

    // özetleme çağrısı yapıldı ve ajanın sonraki istekleri "[özet, ...kuyruk]" ile başlıyor
    expect(env.ai.calls.some((c) => c.messages[0]?.content === SUMMARIZER_PROMPT)).toBe(true);
    const reqs = agentCalls();
    const after = reqs.at(-1)!;
    expect(after.messages[1]!.role).toBe('user');
    expect(after.messages[1]!.content).toContain(SUMMARY_HEADER);
    expect(after.messages.length).toBeLessThan(reqs.length * 2); // baş atıldı
    expect(after.messages.filter((m) => m.role === 'tool').at(-1)!.content).not.toContain('trimmed'); // en son sonuç korunur
    expect(fc.state.commits.length).toBeLessThanOrEqual(1);

    // sonraki tur: geçmiş "özet + sonrası" olarak kurulur, eski komutlar geri gelmez
    env.ai.steps = [text('devam ettim')];
    await send(a, s.chatId, 'şimdi README ekle');
    const next = agentCalls().at(-1)!;
    expect(next.messages[1]!.content).toContain(SUMMARY_HEADER);
    expect(next.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(next.messages.filter((m) => m.role === 'tool').length).toBeLessThan(10); // yalnızca korunan kuyruk geri gelir
    expect(JSON.stringify(next.messages)).not.toContain('gen 3');
  });

  it('özetleme başarısız olursa kırpmayla sürer (araç satırı hata gösterir)', async () => {
    await boot({ CODE_CONTEXT_TOKENS: 8_000 });
    const { a, s } = await prepared();
    fc.state.execImpl = (c) => (c.startsWith('gen') ? { stdout: 'x'.repeat(9_000) } : {});
    const complete = env.ai.complete.bind(env.ai);
    env.ai.complete = async (req) => {
      if (req.messages[0]?.content === SUMMARIZER_PROMPT) throw new Error('özetleyici düştü');
      return complete(req);
    };
    env.ai.steps = [...Array.from({ length: 10 }, (_, i) => [call(`c${i}`, 'bash', { command: `gen ${i}` })]), text('bitti')];
    await send(a, s.chatId, 'bol çıktı');
    const last = lastAssistant(await detail(a, s.chatId));
    expect((last.parts as Array<Record<string, any>>).find((p) => p.name === 'compaction')).toMatchObject({ status: 'error' });
    expect(agentCalls().length).toBeGreaterThan(3);
    const late = agentCalls().at(-1)!.messages.filter((m) => m.role === 'tool');
    expect(late.filter((m) => m.content.includes('trimmed')).length).toBeGreaterThan(0);
  });
});

describe('Code ajan döngüsü: hata, durdurma, kuyruk', () => {
  it('GitHub bağlı değilse net hata; izinsiz kullanıcı 403', async () => {
    const { s } = await prepared();
    const lone = await member(env, { email: 'coder@example.com', verify: true }).catch(() => null);
    void lone;
    const a2 = await member(env, { email: 'baska@example.com' });
    expect((await send(a2, s.chatId, 'x')).status).toBe(404); // başkasının oturumu
    env.ctx.config.codeAllowed.emails.add('nogh@example.com');
    const b = await member(env, { email: 'nogh@example.com' });
    const sb = await env.ctx.code.createSession(b.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
    const r = await send(b, sb.chatId, 'x');
    expect(of(r.events, 'error')[0]).toMatchObject({ code: 'github_required' });
    // izinli olmayan hesap
    const c = await member(env, { email: 'izinsiz@example.com' });
    const chat = await env.app.inject({ method: 'POST', url: '/api/chats', headers: auth(c), payload: {} });
    await env.ctx.db.query(`update chats set kind = 'code' where id = $1`, [chat.json().chat.id]);
    expect((await send(c, chat.json().chat.id, 'x')).status).toBe(403);
  });

  it('çalışma alanı hazırlanamazsa araç kartı hata gösterir ve tur hata ile biter', async () => {
    const { a, s } = await prepared();
    fc.state.failPrepare = 'Repo klonlanamadı: not found';
    const r = await send(a, s.chatId, 'x');
    expect(of(r.events, 'tool_end')[0]).toMatchObject({ status: 'error', output: expect.stringContaining('klonlanamadı') });
    expect(of(r.events, 'error')[0]).toMatchObject({ code: 'upstream_unavailable' });
    expect(env.ai.calls).toHaveLength(0);
    expect((await detail(a, s.chatId)).messages.at(-1).status).toBe('error');
  });

  it('sandboxd yeniden başladıysa araç otomatik hazırlayıp yeniden dener', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('c1', 'bash', { command: 'echo yeniden' })], text('Tamam.')];
    fc.state.execImpl = (c) => {
      if (c === 'echo yeniden') fc.state.needPrepare = true; // ilk çağrıdan sonra sandboxd "unuttu"
      return {};
    };
    // ilk bash çalışır, ardından ikinci çağrı NotPrepared alır: komut tekrar edilince hazırlanır
    const r = await send(a, s.chatId, 'x');
    expect(of(r.events, 'tool_end').find((t) => t.output.includes('echo yeniden'))?.status).toBe('done');
    expect(r.events.some((e) => e.type === 'done')).toBe(true);
  });

  it('kullanıcı durdurursa tur "stopped" olur, çalışma alanındaki iş yine commit edilir', async () => {
    const { a, s } = await prepared();
    fc.state.delayMs = 120;
    env.ai.delayMs = 60;
    env.ai.steps = [[call('c1', 'write', { path: 'w.txt', content: 'w\n' })], [call('c2', 'bash', { command: 'sleep 5' })], text('asla')];
    const pending = send(a, s.chatId, 'uzun iş');
    await new Promise((res) => setTimeout(res, 450));
    const stop = await env.app.inject({ method: 'POST', url: `/api/chats/${s.chatId}/stop`, headers: auth(a) });
    expect(stop.json()).toEqual({ stopped: true });
    const r = await pending;
    expect(r.events.find((e) => e.type === 'done')).toMatchObject({ type: 'done', assistantMessage: { status: 'stopped' } });
    expect(fc.fs.get('w.txt')).toBe('w\n');
    expect(fc.state.commits).toHaveLength(1);
    expect((await env.ctx.code.getSession(a.user.id, s.chatId))!.status).toBe('idle');
  });

  it('havuz doluysa ikinci oturum sırada bekler ve sıra numarası bildirilir', async () => {
    await boot({ CODE_MAX_RUNS: 1 });
    const one = await prepared('coder@example.com');
    env.ctx.config.codeAllowed.emails.add('ikinci@example.com');
    const b = await member(env, { email: 'ikinci@example.com' });
    await env.ctx.code.saveConnection(b.user.id, { id: 7, login: 'iki', avatarUrl: '' }, 'gho_b', 'repo');
    const sb = await env.ctx.code.createSession(b.user.id, { repo: 'iki/repo', baseBranch: 'main' });
    env.ai.delayMs = 150;
    env.ai.steps = [text('birinci bitti'), text('ikinci bitti')];
    const first = send(one.a, one.s.chatId, 'bir');
    await new Promise((res) => setTimeout(res, 120));
    const second = send(b, sb.chatId, 'iki');
    const [r1, r2] = await Promise.all([first, second]);
    expect(of(r2.events, 'phase').filter((p) => p.phase === 'queued').some((p) => p.position === 1)).toBe(true);
    expect(r1.events.some((e) => e.type === 'done')).toBe(true);
    expect(r2.events.find((e) => e.type === 'done')).toMatchObject({ type: 'done', assistantMessage: { content: 'ikinci bitti' } });
    expect(env.ctx.codeQueue.stats).toMatchObject({ running: 0, queued: 0 });
  });

  it('aynı oturumda ikinci eşzamanlı mesaj 409', async () => {
    const { a, s } = await prepared();
    env.ai.delayMs = 150;
    env.ai.steps = [text('uzun cevap')];
    const first = send(a, s.chatId, 'bir');
    await new Promise((res) => setTimeout(res, 80));
    expect((await send(a, s.chatId, 'iki')).status).toBe(409);
    await first;
  });

  it('Code mesajında dosya eki reddedilir', async () => {
    const { a, s } = await prepared();
    const r = await env.app.inject({ method: 'POST', url: `/api/chats/${s.chatId}/messages`, headers: auth(a), payload: { content: 'x', attachments: [{ name: 'a.txt', text: 'x' }] } });
    expect(r.statusCode).toBe(400);
  });

  it('çalışan oturumun durumu "running" görünür; üretim yokken takılı kalan "running" düzeltilir', async () => {
    const { a, s } = await prepared();
    await env.ctx.db.query(`update code_sessions set status = 'running' where chat_id = $1`, [s.chatId]);
    const list = (await env.app.inject({ method: 'GET', url: '/api/code/sessions', headers: auth(a) })).json().sessions;
    expect(list[0].status).toBe('idle');
  });
});

describe('PR listesi', () => {
  it('oturumun çalışma branch\'indeki PR\'ları döndürür', async () => {
    const calls: string[] = [];
    fc = fakeCode();
    const cfg = loadConfig();
    const fetchMock = async (u: string) => {
      calls.push(String(u));
      const url = String(u);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/pulls?')) return json([{ number: 5 }, { number: 6 }]);
      if (url.endsWith('/pulls/5')) return json({ number: 5, title: 'Giriş hatası', state: 'closed', merged: true, html_url: 'https://github.com/octo/alpha/pull/5', additions: 1866, deletions: 532, changed_files: 38 });
      if (url.endsWith('/pulls/6')) return json({ number: 6, title: 'Taslak', state: 'open', draft: true, html_url: 'https://github.com/octo/alpha/pull/6', additions: 3, deletions: 0, changed_files: 1 });
      return json({});
    };
    await env.app.close();
    env = await setup([], { code: fc.client }, { config: cfg, codeSandbox: fc.client, github: createGithub(cfg, fetchMock as unknown as typeof fetch) });
    await resetDb(env.ctx);
    const { a, s } = await prepared();
    const r = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/pulls`, headers: auth(a) });
    expect(r.statusCode).toBe(200);
    expect(r.json().pulls).toEqual([
      { number: 5, title: 'Giriş hatası', state: 'merged', draft: false, url: 'https://github.com/octo/alpha/pull/5', additions: 1866, deletions: 532, changedFiles: 38 },
      { number: 6, title: 'Taslak', state: 'open', draft: true, url: 'https://github.com/octo/alpha/pull/6', additions: 3, deletions: 0, changedFiles: 1 },
    ]);
    expect(calls[0]).toContain(`head=octo%3A${encodeURIComponent(s.workBranch)}`);
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${a.user.id}/pulls`, headers: auth(a) })).statusCode).toBe(404);
  });
});

describe('Değişiklik listesi', () => {
  it('dosya listesini döndürür; ajan çalışırken ya da sandbox yokken son bilinen toplam (stale)', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('c1', 'write', { path: 'a.js', content: 'x\ny\n' })], text('Bitti.')];
    await send(a, s.chatId, 'a.js yaz');
    const r = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/changes`, headers: auth(a) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ files: [{ path: 'a.js', status: 'added', additions: 2, deletions: 0 }], additions: 2, deletions: 0, stale: false });

    fc.client.changes = async () => {
      throw new Error('uykuda');
    };
    const st = (await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/changes`, headers: auth(a) })).json();
    expect(st).toMatchObject({ files: [], additions: 2, deletions: 0, stale: true });
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${a.user.id}/changes`, headers: auth(a) })).statusCode).toBe(404);
  });
});
