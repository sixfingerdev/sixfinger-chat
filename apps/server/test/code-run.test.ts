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
/** Tek turda birden çok araç çağrısı. */
const many = (list: Array<[string, string, object]>): AiChunk => ({ type: 'tool_calls', calls: list.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) });

async function boot(over: Record<string, unknown> = {}, files: Record<string, string> = { 'app.js': 'console.log(1);\n' }) {
  fc = fakeCode(files);
  const config = { ...loadConfig(), ...over } as ReturnType<typeof loadConfig>;
  env = await setup([], { code: fc.client }, { config, codeSandbox: fc.client, github: createGithub(config, (async () => new Response('{}')) as unknown as typeof fetch) });
}

/** Doğrulanmış, izinli, GitHub'a bağlı bir kullanıcı ve bir Code oturumu. */
async function prepared(email = 'coder@example.com', autoPr = false) {
  const a = await member(env, { email });
  await env.ctx.code.saveConnection(a.user.id, { id: 42, login: 'octo', avatarUrl: '' }, 'gho_testtoken', 'repo');
  const s = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
  // Çoğu test PR akışından bağımsızdır: ortamda otomatik PR kapalı başlar (PR testleri açar).
  await env.ctx.db.query('update code_environments set auto_pr = $2 where user_id = $1', [a.user.id, autoPr]);
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
    expect(req.tools?.map((t) => t.function.name)).toEqual(['bash', 'job_output', 'job_kill', 'read', 'write', 'edit', 'glob', 'grep', 'todo', 'preview', 'share_file', 'web_search', 'web_fetch', 'task', 'ask_user']);
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
    await boot({ CODE_CONTEXT_TOKENS: 14_000 });
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
    await boot({ CODE_CONTEXT_TOKENS: 14_000 });
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

  it('kullanıcı durdurursa tur "stopped" olur, çalışma alanındaki iş yine commit edilir (otomatik PR açıksa bile itilmez)', async () => {
    const { a, s } = await prepared('coder@example.com', true);
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
    expect(fc.state.pushes).toHaveLength(0);
    expect(of(r.events, 'tool_end').some((e) => e.id.startsWith('pr-'))).toBe(false);
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

  it('Code mesajına metin eki eklenebilir: modele <ek> bloğu olarak gider, mesajda saklanır', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [text('okudum')];
    const r = await env.app.inject({ method: 'POST', url: `/api/chats/${s.chatId}/messages`, headers: auth(a), payload: { content: 'Bu hatayı düzelt', attachments: [{ name: 'hata.log', text: 'TypeError: x is undefined' }] } });
    expect(r.statusCode).toBe(200);
    const sent = agentCalls()[0]!.messages.find((m) => m.role === 'user')!.content as string;
    expect(sent).toContain('<ek ad="hata.log">');
    expect(sent).toContain('TypeError: x is undefined');
    const d = await detail(a, s.chatId);
    expect(d.messages.find((m: { role: string }) => m.role === 'user').attachments).toHaveLength(1);
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

describe('GitHub: ajanın PR akışı, push, fark', () => {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  let existing = false;
  async function bootGit(firstTurn = true, autoPr = false) {
    calls.length = 0;
    existing = false;
    fc = fakeCode({ 'app.js': 'console.log(1);\n' });
    const cfg = loadConfig();
    const fetchMock = async (u: string, init?: RequestInit) => {
      const url = String(u);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      calls.push({ method: init?.method ?? 'GET', url, body: String(init?.body ?? '') });
      if (init?.method === 'POST' && url.endsWith('/pulls')) {
        if (existing) return json({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists for octo:x.' }] }, 422);
        return json({ number: 7, title: JSON.parse(String(init.body)).title, state: 'open', draft: JSON.parse(String(init.body)).draft, html_url: 'https://github.com/octo/alpha/pull/7' }, 201);
      }
      if (url.includes('/pulls?')) return json([{ number: 3 }]);
      if (url.endsWith('/pulls/3')) return json({ number: 3, title: 'Var olan', state: 'open', draft: false, html_url: 'https://github.com/octo/alpha/pull/3', additions: 5, deletions: 1, changed_files: 2 });
      return json({});
    };
    await env.app.close();
    env = await setup([], { code: fc.client }, { config: cfg, codeSandbox: fc.client, github: createGithub(cfg, fetchMock as unknown as typeof fetch) });
    await resetDb(env.ctx);
    fc.state.execImpl = (c) => {
      if (c.includes('git log --reverse')) return { stdout: 'feat: a.js ekle\n---STAT---\n a.js | 2 ++\n 1 file changed, 2 insertions(+)\n' };
      if (c.includes('git diff --cached --no-color')) return { stdout: 'diff --git a/a.js b/a.js\nnew file mode 100644\n--- /dev/null\n+++ b/a.js\n@@ -0,0 +1,2 @@\n+x\n+y\n' };
      return {};
    };
    const { a, s } = await prepared('coder@example.com', autoPr);
    if (firstTurn) {
      env.ai.steps = [[call('c1', 'write', { path: 'a.js', content: 'x\ny\n' })], text('Tamam.')];
      await send(a, s.chatId, 'a.js ekle');
    }
    return { a, s };
  }
  const get = (a: Awaited<ReturnType<typeof member>>, url: string) => env.app.inject({ method: 'GET', url: `/api${url}`, headers: auth(a) });
  const post = (a: Awaited<ReturnType<typeof member>>, url: string, payload: object = {}) => env.app.inject({ method: 'POST', url: `/api${url}`, headers: auth(a), payload });

  it('manuel yeniden deneme (POST /pr): model başlık/açıklama yazar, push eder, PR açar; ikinci çağrıda yalnızca push (PR kalır)', async () => {
    const { a, s } = await bootGit();
    env.ai.completeText = 'Boş şifreyi reddet\n\n## Summary\n- a.js eklendi';
    expect(fc.state.pushes).toHaveLength(0);
    const r = await post(a, `/code/sessions/${s.chatId}/pr`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ created: true, existed: false, pull: { number: 7, url: 'https://github.com/octo/alpha/pull/7' } });
    expect(fc.state.pushes).toEqual([{ token: 'gho_testtoken', sha: expect.stringMatching(/^c+1$/), force: false }]);
    const prCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'))!;
    const sent = JSON.parse(prCall.body);
    expect(sent).toMatchObject({ head: s.workBranch, base: 'main', draft: false, title: 'Boş şifreyi reddet' });
    expect(sent.body).toContain('## Summary');
    expect(sent.body).toContain('Created with SixFinger Code');
    expect(sent.body).not.toContain('/code/s/'); // oturum bağlantısı varsayılan kapalı

    const sess = (await get(a, `/code/sessions/${s.chatId}`)).json().session;
    expect(sess).toMatchObject({ prNumber: 7, prUrl: 'https://github.com/octo/alpha/pull/7' });
    expect(sess.pushedSha).toBe(sess.headSha);

    const again = await post(a, `/code/sessions/${s.chatId}/pr`);
    expect(again.json()).toMatchObject({ created: false, pull: null });
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toHaveLength(1);
    expect(fc.state.pushes).toHaveLength(2);
  });

  it('tur sonunda ajan kendisi açar: ilk turda push + PR (pull_request parçası), sonraki turda aynı PR güncellenir', async () => {
    const { a, s } = await bootGit(false, true); // ilk tur: henüz hiç commit yok
    env.ai.completeText = 'Dosya ekle\n\n## Summary\n- x';
    env.ai.steps = [[call('p1', 'write', { path: 'b.js', content: 'b\n' })], text('b.js eklendi, tamam.')];
    const r = await send(a, s.chatId, 'b.js ekle');
    expect(of(r.events, 'phase').map((p) => p.phase)).toEqual(['queued', 'preparing', 'working', 'committing', 'publishing']);
    const prEnd = of(r.events, 'tool_end').find((e) => e.id.startsWith('pr-'))!;
    expect(prEnd).toMatchObject({ status: 'done', summary: '#7', output: 'https://github.com/octo/alpha/pull/7', meta: { number: 7, created: true } });
    const last = lastAssistant(await detail(a, s.chatId));
    expect((last.parts as Array<Record<string, any>>).find((p) => p.name === 'pull_request')).toMatchObject({ status: 'done', meta: { number: 7 } });
    expect(fc.state.pushes).toHaveLength(1);
    // model, ajanın son raporunu görerek PR'ı yazdı
    expect(env.ai.calls.some((c) => c.messages.some((m) => typeof m.content === 'string' && m.content.includes("The agent's final report") && m.content.includes('b.js eklendi, tamam.')))).toBe(true);
    // PR modelin başlığıyla, gövdesi footer'lı
    const sent = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'))!.body);
    expect(sent.title).toBe('Dosya ekle');

    // ikinci tur: yeni commit itilir, PR yeniden açılmaz
    env.ai.steps = [[call('p2', 'write', { path: 'c.js', content: 'c\n' })], text('c.js eklendi.')];
    const r2 = await send(a, s.chatId, 'c.js ekle');
    const end2 = of(r2.events, 'tool_end').find((e) => e.id.startsWith('pr-'))!;
    expect(end2).toMatchObject({ status: 'done', summary: 'updated' });
    expect(fc.state.pushes).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toHaveLength(1);
  });

  it('otomatik PR: kapalıysa, tur durdurulduysa ya da değişiklik yoksa hiçbir şey itilmez; push hatası turu bozmaz', async () => {
    const { a, s } = await bootGit(); // autoPr kapalı
    env.ai.steps = [[call('q1', 'write', { path: 'd.js', content: 'd\n' })], text('bitti')];
    const off = await send(a, s.chatId, 'd.js ekle');
    expect(of(off.events, 'tool_end').some((e) => e.id.startsWith('pr-'))).toBe(false);
    expect(fc.state.pushes).toHaveLength(0);

    await env.ctx.db.query('update code_environments set auto_pr = true where user_id = $1', [a.user.id]);
    // değişiklik yok: commit yok, push yok
    env.ai.steps = [text('Sadece bir soruydu.')];
    const none = await send(a, s.chatId, 'merhaba');
    expect(of(none.events, 'phase').map((p) => p.phase)).not.toContain('publishing');
    expect(fc.state.pushes).toHaveLength(0);

    // push hatası: PR satırı hata gösterir, tur yine de tamamlanır ve commit korunur
    fc.state.failPush = 'Push başarısız: permission denied';
    env.ai.steps = [[call('q2', 'write', { path: 'e.js', content: 'e\n' })], text('e.js eklendi.')];
    const bad = await send(a, s.chatId, 'e.js ekle');
    const end = of(bad.events, 'tool_end').find((e) => e.id.startsWith('pr-'))!;
    expect(end).toMatchObject({ status: 'error' });
    expect(end.output).toContain('permission denied');
    const d = lastAssistant(await detail(a, s.chatId));
    expect(d.status).toBe('complete');
    expect(fc.state.commits.length).toBeGreaterThan(0);
  });

  it('hatalar: push başarısızsa 502 ve neden; başkasının oturumu 404; çalışırken 409; commit yokken 409', async () => {
    const { a, s } = await bootGit();
    fc.state.failPush = 'Push başarısız: non-fast-forward';
    const bad = await post(a, `/code/sessions/${s.chatId}/push`);
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.message).toContain('non-fast-forward');
    fc.state.failPush = null;

    env.ctx.config.codeAllowed.emails.add('baska@example.com');
    const other = await member(env, { email: 'baska@example.com' });
    expect((await post(other, `/code/sessions/${s.chatId}/push`)).statusCode).toBe(404);
    expect((await post(other, `/code/sessions/${s.chatId}/pr`)).statusCode).toBe(404);
    expect((await get(other, `/code/sessions/${s.chatId}/diff`)).statusCode).toBe(404);

    const empty = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
    expect((await post(a, `/code/sessions/${empty.chatId}/pr`)).statusCode).toBe(409);

    // sandboxd yeniden başlamışsa çalışma alanı otomatik hazırlanıp push yeniden denenir
    fc.state.needPrepare = true;
    const prepares = fc.state.prepares.length;
    expect((await post(a, `/code/sessions/${s.chatId}/push`)).statusCode).toBe(200);
    expect(fc.state.prepares).toHaveLength(prepares + 1);

    // ajan çalışırken itme reddedilir; fark "stale" döner
    fc.state.delayMs = 400;
    env.ai.steps = [[call('d1', 'bash', { command: 'sleep 1' })], [call('d2', 'bash', { command: 'sleep 1' })], text('bitti')];
    const running = send(a, s.chatId, 'uzun iş');
    await new Promise((r) => setTimeout(r, 500));
    expect((await post(a, `/code/sessions/${s.chatId}/push`)).statusCode).toBe(409);
    expect((await get(a, `/code/sessions/${s.chatId}/diff`)).json()).toMatchObject({ stale: true, diff: '' });
    await running;
  });

  it('dosya gezgini: dosya içeriği, klasör/yok hataları; arşiv indirme başlıkları', async () => {
    const { a, s } = await bootGit(); // a.js yazıldı
    const f = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/file?path=a.js`, headers: auth(a) });
    expect(f.json()).toEqual({ path: 'a.js', content: 'x\ny\n', truncated: false });
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/file?path=yok.js`, headers: auth(a) })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/file`, headers: auth(a) })).statusCode).toBe(400);
    const z = await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/archive`, headers: auth(a) });
    expect(z.statusCode).toBe(200);
    expect(z.headers['content-type']).toContain('application/gzip');
    expect(z.headers['content-disposition']).toBe('attachment; filename="alpha.tar.gz"');
    expect(z.rawPayload.subarray(0, 2).toString('hex')).toBe('1f8b');
  });

  it('geri sarma (checkpoint): çalışma alanı o turun commit\'ine sıfırlanır, sohbet ucu çekilir, uzak ileride kalırsa sonraki push zorla', async () => {
    const { a, s } = await bootGit(false, true); // otomatik PR açık
    const resets: string[] = [];
    fc.state.execImpl = (c) => {
      if (c.includes('git reset')) {
        resets.push(c);
        const m = /--hard '([0-9a-f]{40})'/.exec(c);
        return { stdout: `${m ? m[1] : 'b'.repeat(40)}\n` };
      }
      if (c.includes('git log --reverse')) return { stdout: 'x\n---STAT---\n' };
      return {};
    };
    env.ai.steps = [[call('r1', 'write', { path: 'one.js', content: '1\n' })], text('birinci')];
    await send(a, s.chatId, 'bir');
    env.ai.steps = [[call('r2', 'write', { path: 'two.js', content: '2\n' })], text('ikinci')];
    await send(a, s.chatId, 'iki');
    const d = await detail(a, s.chatId);
    const asst = d.messages.filter((m: { role: string }) => m.role === 'assistant');
    expect(asst).toHaveLength(2);
    const firstSha = (asst[0].parts as Array<Record<string, any>>).find((p) => p.name === 'commit')!.meta.sha;
    const before = (await env.ctx.code.getSession(a.user.id, s.chatId))!;
    expect(before.pushedSha).toBe(before.headSha); // ikinci turda itildi
    expect(before.headSha).not.toBe(firstSha);

    const r = await post(a, `/code/sessions/${s.chatId}/rewind`, { messageId: asst[0].id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sha: firstSha, session: { headSha: firstSha, forcePush: true } });
    expect(resets[0]).toContain(`--hard '${firstSha}'`);
    expect(resets[0]).toContain('git clean -qfd');
    expect((await detail(a, s.chatId)).chat.leafId).toBe(asst[0].id);

    // sonraki push zorla yapılır ve bayrak temizlenir
    await post(a, `/code/sessions/${s.chatId}/push`);
    expect(fc.state.pushes.at(-1)).toMatchObject({ force: true });
    expect((await env.ctx.code.getSession(a.user.id, s.chatId))!.forcePush).toBe(false);
    await post(a, `/code/sessions/${s.chatId}/push`);
    expect(fc.state.pushes.at(-1)).toMatchObject({ force: false });

    // kullanıcı mesajına ya da başkasının mesajına sarılamaz
    const user = d.messages.find((m: { role: string }) => m.role === 'user');
    expect((await post(a, `/code/sessions/${s.chatId}/rewind`, { messageId: user.id })).statusCode).toBe(404);
    expect((await post(a, `/code/sessions/${s.chatId}/rewind`, { messageId: 'nope' })).statusCode).toBe(400);
  });

  it('fark ucu: tek dosya için yolu güvenli iletir, çıktıyı döndürür', async () => {
    const { a, s } = await bootGit();
    const r = (await get(a, `/code/sessions/${s.chatId}/diff?path=${encodeURIComponent("a b'.js")}`)).json();
    expect(r).toMatchObject({ stale: false, truncated: false });
    expect(r.diff).toContain('+++ b/a.js');
    expect(fc.state.execs.some((c) => c.includes("-- 'a b'\\''.js'"))).toBe(true);
  });
});

describe('Ajan yetenekleri: soru, plan, alt ajan, /compact, talimatlar, arka plan işleri', () => {
  const sendPlan = async (a: Awaited<ReturnType<typeof member>>, chatId: string, content: string, planMode: boolean) => {
    const r = await env.app.inject({ method: 'POST', url: `/api/chats/${chatId}/messages`, headers: auth(a), payload: { content, planMode } });
    return { status: r.statusCode, events: parseSse(r.body) };
  };

  it('ask_user turu bitirir: soru kartı verisi (meta) ile, model bir daha çağrılmaz', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('q1', 'ask_user', { questions: [{ question: 'Hangi veritabanı?', header: 'DB', options: [{ label: 'Postgres', description: 'önerilen' }, { label: 'SQLite' }] }] })], text('asla')];
    const r = await send(a, s.chatId, 'veritabanı ekle');
    const end = of(r.events, 'tool_end').find((e) => e.id === 'q1')!;
    expect(end).toMatchObject({ status: 'done', meta: { terminal: true, questions: [{ question: 'Hangi veritabanı?', header: 'DB' }] } });
    expect(agentCalls()).toHaveLength(1);
    const d = lastAssistant(await detail(a, s.chatId));
    expect(d.status).toBe('complete');
    expect((d.parts as Array<Record<string, any>>).find((p) => p.name === 'ask_user')).toBeTruthy();
    // geçersiz soru (tek seçenek) hata döner ve tur sürer
    env.ai.steps = [[call('q2', 'ask_user', { questions: [{ question: 'Emin misin?', options: [{ label: 'Evet' }] }] })], text('tamam, kendim seçtim')];
    const r2 = await send(a, s.chatId, 'devam');
    expect(of(r2.events, 'tool_end').find((e) => e.id === 'q2')).toMatchObject({ status: 'error' });
    expect(lastAssistant(await detail(a, s.chatId)).content).toContain('kendim seçtim');
  });

  it('plan modu: yalnızca okuma araçları + exit_plan_mode; plan sunulunca tur biter; istemde PLAN MODE var', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [[call('p1', 'read', { path: 'app.js' })], [call('p2', 'exit_plan_mode', { plan: '## Hedef\n- app.js içine log ekle\n## Adımlar\n1. edit\n2. test çalıştır' })], text('asla')];
    const r = await sendPlan(a, s.chatId, 'log ekle', true);
    const names = agentCalls()[0]!.tools!.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['read', 'glob', 'grep', 'todo', 'task', 'ask_user', 'exit_plan_mode']));
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('bash');
    expect(String(agentCalls()[0]!.messages[0]!.content)).toContain('PLAN MODE');
    const end = of(r.events, 'tool_end').find((e) => e.id === 'p2')!;
    expect(end.meta).toMatchObject({ terminal: true, plan: expect.stringContaining('app.js içine log ekle') });
    expect(agentCalls()).toHaveLength(2);
    expect(fc.state.commits).toHaveLength(0);
    // normal modda exit_plan_mode yok
    env.ai.steps = [text('tamam')];
    await send(a, s.chatId, 'uygula');
    expect(agentCalls().at(-1)!.tools!.map((t) => t.function.name)).not.toContain('exit_plan_mode');
  });

  it('alt ajan (task): taze bağlam, salt okunur araçlar, yalnızca rapor ana bağlama döner', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [
      [call('t1', 'task', { description: 'Girişi bul', prompt: 'Giriş işlevinin nerede tanımlandığını bul ve dosya:satır olarak raporla.' })],
      [call('s1', 'grep', { pattern: 'console' })], // alt ajan
      text('Rapor: app.js:1 içinde console.log var.'), // alt ajan raporu
      text('Alt ajan app.js:1 dedi.'), // ana ajan
    ];
    const r = await send(a, s.chatId, 'girişi bul');
    const end = of(r.events, 'tool_end').find((e) => e.id === 't1')!;
    expect(end).toMatchObject({ status: 'done', output: 'Rapor: app.js:1 içinde console.log var.', summary: '2 steps', meta: { agent: 'explore', steps: 2, tools: { grep: 1 } } });
    const reqs = agentCalls();
    expect(reqs).toHaveLength(4);
    // alt ajan: kendi sistem istemi, yalnızca kullanıcı görevi, salt okunur araçlar
    expect(String(reqs[1]!.messages[0]!.content)).toContain('sub-agent');
    expect(reqs[1]!.messages).toHaveLength(2);
    expect(reqs[1]!.tools!.map((t) => t.function.name).sort()).toEqual(['glob', 'grep', 'read', 'web_fetch', 'web_search']);
    // ana ajanın ikinci isteğinde yalnızca rapor var (alt ajanın grep sonucu yok)
    const mainSecond = reqs[3]!.messages.filter((m) => m.role === 'tool');
    expect(mainSecond).toHaveLength(1);
    expect(mainSecond[0]!.content).toContain('Rapor: app.js:1');
    expect(lastAssistant(await detail(a, s.chatId)).content).toContain('Alt ajan app.js:1 dedi.');
  });

  it('/compact: modele sormadan bağlamı özetler; sonraki turun geçmişi özetle başlar ve "/compact" metni taşımaz', async () => {
    const { a, s } = await prepared();
    env.ai.steps = [text('Merhaba, nasıl yardımcı olabilirim?')];
    await send(a, s.chatId, 'selam, projeyi tanıtır mısın');
    const before = agentCalls().length;
    env.ai.completeText = 'OZET: kullanıcı projeyi sordu.';
    const r = await send(a, s.chatId, '/compact');
    expect(agentCalls()).toHaveLength(before); // ajan çağrılmadı
    const d = lastAssistant(await detail(a, s.chatId));
    expect((d.parts as Array<Record<string, any>>).find((p) => p.name === 'compaction')).toMatchObject({ status: 'done', meta: { keepUser: true } });
    expect(d.content).toContain('özetlendi');
    expect(of(r.events, 'error')).toHaveLength(0);

    env.ai.steps = [text('devam ediyorum')];
    await send(a, s.chatId, 'şimdi README yaz');
    const next = agentCalls().at(-1)!;
    expect(next.messages[1]!.content).toContain('OZET: kullanıcı projeyi sordu.');
    expect(JSON.stringify(next.messages)).not.toContain('/compact');
    expect(next.messages.at(-1)).toMatchObject({ role: 'user' });

    // özetlenecek bir şey yoksa
    const fresh = await env.ctx.code.createSession(a.user.id, { repo: 'octo/alpha', baseBranch: 'main' });
    const none = await send(a, fresh.chatId, '/compact');
    expect(lastAssistant(await detail(a, fresh.chatId)).content).toContain('Özetlenecek bir şey yok');
    expect(of(none.events, 'error')).toHaveLength(0);
  });

  it('ortam talimatları her turun sistem istemine girer', async () => {
    const { a, s } = await prepared();
    await env.ctx.db.query(`update code_environments set instructions = $2 where user_id = $1`, [a.user.id, 'Her zaman pnpm kullan. Commit mesajları Türkçe olsun.']);
    env.ai.steps = [text('tamam')];
    await send(a, s.chatId, 'merhaba');
    const sys = String(agentCalls()[0]!.messages[0]!.content);
    expect(sys).toContain('Instructions from the user');
    expect(sys).toContain('Her zaman pnpm kullan.');
  });

  it('arka plan işleri: job_output durumu ve çıktıyı gösterir; olmayan iş açıklayıcı hata verir; bash pid dosyası yazar', async () => {
    const { a, s } = await prepared();
    fc.state.execImpl = (c) => {
      if (c.includes('sf-bg-abc123.log') && c.includes('STATE')) return { stdout: 'sunucu hazır :3000\n---STATE---\nrunning\n' };
      if (c.includes('sf-bg-ffffff.log')) return { stdout: 'NOJOB\n' };
      return {};
    };
    env.ai.steps = [
      [call('b1', 'bash', { command: 'npm run dev', background: true })],
      [call('j1', 'job_output', { id: 'abc123' })],
      [call('j2', 'job_output', { id: 'ffffff' })],
      [call('j3', 'job_kill', { id: 'zzz' })],
      text('bitti'),
    ];
    const r = await send(a, s.chatId, 'sunucuyu başlat');
    const ends = of(r.events, 'tool_end');
    expect(fc.state.execs.some((c) => c.includes('echo $! > /tmp/sf-bg-') && c.includes('.pid'))).toBe(true);
    expect(ends.find((e) => e.id === 'j1')).toMatchObject({ status: 'done', output: expect.stringContaining('[job abc123: running]') });
    expect(ends.find((e) => e.id === 'j1')!.output).toContain('sunucu hazır :3000');
    expect(ends.find((e) => e.id === 'j2')).toMatchObject({ status: 'error' });
    expect(ends.find((e) => e.id === 'j3')).toMatchObject({ status: 'error' });
  });

  it('repo slash komutları ve @dosya önerisi/dosya listesi uçları', async () => {
    const { a, s } = await prepared();
    fc.state.execImpl = (c) => {
      if (c.includes('.claude/commands')) return { stdout: '@@FILE .claude/commands/lint.md\n---\ndescription: Lint düzelt\n---\nLint çalıştır. $ARGUMENTS\n\n@@FILE .sixfinger/commands/lint.md\nçakışan ad atlanır\n@@FILE .sixfinger/commands/deploy.md\n# Yayınla\nAdımlar\n' };
      if (c.includes('git ls-files') && c.includes("grep -i -F -- 'auth'")) return { stdout: 'src/auth/login.ts\nsrc/auth/login.test.ts\n' };
      if (c.includes('git ls-files')) return { stdout: 'README.md\nsrc/app.ts\n' };
      return {};
    };
    const cmds = (await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/commands`, headers: auth(a) })).json().commands;
    expect(cmds.map((c: { name: string }) => c.name)).toEqual(['lint', 'deploy']);
    expect(cmds[0]).toMatchObject({ description: 'Lint düzelt', template: 'Lint çalıştır. $ARGUMENTS', source: 'repo' });
    const f = (await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/files?q=auth`, headers: auth(a) })).json();
    expect(f).toEqual({ files: ['src/auth/login.ts', 'src/auth/login.test.ts'], truncated: false });
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/files`, headers: auth(a) })).json().files).toEqual(['README.md', 'src/app.ts']);
    // başkasının oturumu
    env.ctx.config.codeAllowed.emails.add('baska@example.com');
    const other = await member(env, { email: 'baska@example.com' });
    expect((await env.app.inject({ method: 'GET', url: `/api/code/sessions/${s.chatId}/files`, headers: auth(other) })).statusCode).toBe(404);
  });
});

describe('Önizleme, indirme ve yükleme', () => {
  const post = (a: Awaited<ReturnType<typeof member>>, url: string, payload: object = {}) => env.app.inject({ method: 'POST', url: `/api${url}`, headers: auth(a), payload });
  const get = (a: Awaited<ReturnType<typeof member>>, url: string) => env.app.inject({ method: 'GET', url: `/api${url}`, headers: auth(a) });
  const pub = (url: string, init: { method?: 'GET' | 'POST' | 'OPTIONS' | 'HEAD'; headers?: Record<string, string>; payload?: string } = {}) => env.app.inject({ method: init.method ?? 'GET', url, headers: init.headers, payload: init.payload });
  const SITE_HTML = '<!doctype html><link rel="stylesheet" href="/style.css"><script type="module" src="app.js"></script><img src="/img/logo.png" srcset="/img/a.png 1x, /img/b.png 2x"><a href="//cdn.example/x">cdn</a>';

  async function withSite() {
    await boot();
    await resetDb(env.ctx);
    const { a, s } = await prepared();
    fc.fs.set('site/index.html', SITE_HTML);
    fc.fs.set('site/app.js', "import { x } from './lib.js'; console.log(x);\n");
    fc.fs.set('site/lib.js', 'export const x = 1;\n');
    fc.fs.set('site/style.css', "body{background:url(/img/bg.png)}\n@import '/base.css';\n");
    fc.bin.set('site/img/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]));
    return { a, s };
  }

  it('statik önizleme: dosya ve klasör verilebilir; çok dosyalı site (js/css/ikili) sunulur, köke göre bağlantılar önekle yeniden yazılır', async () => {
    const { a, s } = await withSite();
    const r = await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'site/index.html' });
    expect(r.statusCode).toBe(200);
    const { url, kind, entry } = r.json();
    expect(kind).toBe('file');
    expect(entry).toBe('site/index.html');
    expect(url).toMatch(/^\/api\/code\/preview\/[\w.-]+\/index\.html$/);
    const prefix = url.slice(0, url.lastIndexOf('/index.html'));

    const html = await pub(url);
    expect(html.statusCode).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.headers['content-security-policy']).toMatch(/^sandbox allow-scripts/);
    expect(html.headers['access-control-allow-origin']).toBe('*');
    expect(html.headers['x-frame-options']).toBeUndefined();
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.body).toContain(`href="${prefix}/style.css"`);
    expect(html.body).toContain(`src="app.js"`); // göreli bağlantılara dokunulmaz
    expect(html.body).toContain(`src="${prefix}/img/logo.png"`);
    expect(html.body).toContain(`${prefix}/img/a.png 1x, ${prefix}/img/b.png 2x`);
    expect(html.body).toContain('href="//cdn.example/x"'); // protokole göreli dış adres kalır

    const js = await pub(`${prefix}/app.js`);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.body).toContain("from './lib.js'");
    const css = await pub(`${prefix}/style.css`);
    expect(css.body).toContain(`url(${prefix}/img/bg.png)`);
    expect(css.body).toContain(`@import '${prefix}/base.css'`);
    const png = await pub(`${prefix}/img/logo.png`);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.toString('hex')).toBe('89504e4700ff');

    // klasör verilince index.html açılır; köke GET ile de gelinir
    const dir = await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'site' });
    expect(dir.json().entry).toBe('site/index.html');
    expect((await pub(`${dir.json().url.replace(/index\.html$/, '')}`)).statusCode).toBe(200);
  });

  it('statik önizleme güvenliği: kök dışına çıkış, kurcalanmış/başka amaçlı token, bilinmeyen dosya, yazma yöntemleri', async () => {
    const { a, s } = await withSite();
    fc.fs.set('gizli.txt', 'sir');
    const { url } = (await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'site/index.html' })).json();
    const prefix = url.slice(0, url.lastIndexOf('/index.html'));
    expect((await pub(`${prefix}/..%2fgizli.txt`)).body).not.toContain('sir');
    expect((await pub(`${prefix}/%2e%2e/gizli.txt`)).body).not.toContain('sir');
    expect((await pub(`${prefix}/..%5cgizli.txt`)).body).not.toContain('sir');
    expect((await pub(`${prefix}/yok.js`)).statusCode).toBe(404);
    expect((await pub(`${prefix}/app.js`, { method: 'POST', headers: { 'content-type': 'text/plain' }, payload: 'x' })).statusCode).toBe(405);
    const token = prefix.split('/').pop()!;
    expect((await pub(`/api/code/preview/${token.slice(0, -2)}xx/index.html`)).statusCode).toBe(404);
    // OAuth state gibi başka amaçlı imzalı değerler önizleme token'ı sayılmaz
    const state = env.ctx.secrets!.signState({ u: 'x', t: 'web' }, 60);
    expect((await pub(`/api/code/preview/${state}/index.html`)).statusCode).toBe(404);
    // süresi dolmuş
    const old = env.ctx.secrets!.signState({ k: 'pv', u: 'x', c: 'y', f: 'file', r: '' }, -5);
    expect((await pub(`/api/code/preview/${old}/index.html`)).statusCode).toBe(404);
  });

  it('mint: dosya yok → 404; başkasının oturumu → 404; yol dışarı çıkamaz; path ya da port gerekli', async () => {
    const { a, s } = await withSite();
    env.ctx.config.codeAllowed.emails.add('other@example.com');
    const b = await member(env, { email: 'other@example.com' });
    expect((await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'yok.html' })).statusCode).toBe(404);
    expect((await post(b, `/code/sessions/${s.chatId}/preview`, { path: 'site/index.html' })).statusCode).toBe(404);
    expect((await post(a, `/code/sessions/${s.chatId}/preview`, { path: '../etc/passwd' })).statusCode).toBe(400);
    expect((await post(a, `/code/sessions/${s.chatId}/preview`, {})).statusCode).toBe(400);
    expect((await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'a.html', port: 3000 })).statusCode).toBe(400);
  });

  it('CORS: opak kaynaklı (Origin: null) iframe için önizleme uçları herkese açık, diğer uçlar kapalı kalır', async () => {
    const { a, s } = await withSite();
    const { url } = (await post(a, `/code/sessions/${s.chatId}/preview`, { path: 'site/index.html' })).json();
    const pre = await pub(url, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-ozel' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    const other = await env.app.inject({ method: 'OPTIONS', url: '/api/chats', headers: { origin: 'null', 'access-control-request-method': 'GET' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('dev-server önizleme: port dinlemiyorsa 409; varsa istekler iletilir (yöntem, gövde, sorgu), çerez gitmez, yönlendirme/JS yeniden yazılır', async () => {
    const { a, s } = await withSite();
    expect((await post(a, `/code/sessions/${s.chatId}/preview`, { port: 5173 })).statusCode).toBe(409);
    fc.state.servers.set(5173, (r) => {
      if (r.path === '/') return { status: 200, headers: [['content-type', 'text/html'], ['set-cookie', 'a=b']], body: '<script type="module" src="/src/main.js"></script>' };
      if (r.path === '/src/main.js') return { status: 200, headers: [['content-type', 'text/javascript']], body: 'import { a } from "/src/a.js";\nconst s = "/kalir";\nexport default import("/src/b.js");' };
      if (r.path === '/gec') return { status: 302, headers: [['location', 'http://localhost:5173/hedef'], ['content-type', 'text/plain']], body: '' };
      return { status: 201, headers: [['content-type', 'application/json']], body: JSON.stringify({ m: r.method, p: r.path, b: r.body?.toString() ?? '' }) };
    });
    const r = await post(a, `/code/sessions/${s.chatId}/preview`, { port: 5173 });
    expect(r.statusCode).toBe(200);
    expect(r.json().kind).toBe('port');
    const base = r.json().url.replace(/\/$/, '');

    const home = await pub(`${base}/`, { headers: { cookie: 'x=1', accept: 'text/html' } });
    expect(home.statusCode).toBe(200);
    expect(home.headers['set-cookie']).toBeUndefined();
    expect(home.headers['content-security-policy']).toMatch(/^sandbox/);
    expect(home.body).toContain(`src="${base}/src/main.js"`);
    expect(fc.state.httpCalls[0]!.headers.accept).toBe('text/html');

    const mod = await pub(`${base}/src/main.js`);
    expect(mod.body).toContain(`from "${base}/src/a.js"`);
    expect(mod.body).toContain(`import("${base}/src/b.js")`);
    expect(mod.body).toContain('"/kalir"'); // modül belirteci olmayan dizgeler değişmez

    const redir = await pub(`${base}/gec`);
    expect(redir.statusCode).toBe(302);
    expect(redir.headers.location).toBe(`${base}/hedef`);

    const p = await pub(`${base}/api/x?y=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toEqual({ m: 'POST', p: '/api/x?y=1', b: '{"a":1}' });

    fc.state.servers.clear();
    const dead = await pub(`${base}/`);
    expect(dead.statusCode).toBe(502);
    expect(dead.headers['content-type']).toContain('text/html');
  });

  it('preview aracı: dosya ve port doğrulanır, kart meta verisi döner; yoksa model açıklayıcı hata görür', async () => {
    const { a, s } = await withSite();
    fc.fs.set('game/index.html', '<canvas></canvas>');
    fc.state.servers.set(8080, () => ({ status: 200, body: 'ok' }));
    env.ai.steps = [
      [many([['p1', 'preview', { path: 'game/index.html', title: 'Oyun' }], ['p2', 'preview', { port: 8080 }], ['p3', 'preview', { path: 'yok.html' }], ['p4', 'preview', { port: 3999 }], ['p5', 'preview', { path: 'game' }], ['p6', 'preview', { path: 'a', port: 1 }]])],
      text('Hazır.'),
    ];
    const r = await send(a, s.chatId, 'oyun yap');
    const parts = (lastAssistant(await detail(a, s.chatId)).parts as Array<{ type: string; name?: string; status?: string; meta?: Record<string, unknown>; output?: string }>).filter((p) => p.name === 'preview');
    expect(r.status).toBe(200);
    expect(parts.map((p) => p.status)).toEqual(['done', 'done', 'error', 'error', 'done', 'error']);
    expect(parts[0]!.meta).toMatchObject({ path: 'game/index.html', title: 'Oyun' });
    expect(parts[1]!.meta).toMatchObject({ port: 8080 });
    expect(parts[3]!.output).toContain('Nothing is listening on port 3999');
    expect(parts[4]!.meta).toMatchObject({ path: 'game/index.html', root: 'game' });
    expect(parts[5]!.output).toContain('exactly one');
  });

  it('share_file aracı: boyut ve ad meta verisinde; klasör, yok ve çok büyük dosya hata', async () => {
    const { a, s } = await withSite();
    fc.fs.set('out/rapor.csv', 'a,b\n1,2\n');
    fc.state.execImpl = (c) => {
      if (c.includes("p='out/rapor.csv'")) return { stdout: '8\n' };
      if (c.includes("p='out'")) return { stdout: 'DIR\n' };
      if (c.includes("p='buyuk.bin'")) return { stdout: `${100 * 1_048_576}\n` };
      return { stdout: 'NONE\n' };
    };
    env.ai.steps = [[many([['s1', 'share_file', { path: 'out/rapor.csv', description: 'Aylık rapor' }], ['s2', 'share_file', { path: 'out' }], ['s3', 'share_file', { path: 'yok.txt' }], ['s4', 'share_file', { path: 'buyuk.bin' }]])], text('Verdim.')];
    await send(a, s.chatId, 'rapor ver');
    const parts = (lastAssistant(await detail(a, s.chatId)).parts as Array<{ name?: string; status?: string; meta?: Record<string, unknown>; output?: string }>).filter((p) => p.name === 'share_file');
    expect(parts.map((p) => p.status)).toEqual(['done', 'error', 'error', 'error']);
    expect(parts[0]!.meta).toEqual({ path: 'out/rapor.csv', name: 'rapor.csv', size: 8, description: 'Aylık rapor' });
    expect(parts[1]!.output).toContain('directory');
    expect(parts[3]!.output).toContain('limit');
  });

  it('indirme: ham bayt, ad ve yalıtım başlıkları; yok → 404, klasör → 400, başkasının oturumu → 404', async () => {
    const { a, s } = await withSite();
    env.ctx.config.codeAllowed.emails.add('dl-other@example.com');
    const b = await member(env, { email: 'dl-other@example.com' });
    const ok = await get(a, `/code/sessions/${s.chatId}/download?path=${encodeURIComponent('site/img/logo.png')}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['content-disposition']).toContain('attachment; filename="logo.png"');
    expect(ok.headers['content-security-policy']).toBe('sandbox');
    expect(ok.rawPayload.toString('hex')).toBe('89504e4700ff');
    expect((await get(a, `/code/sessions/${s.chatId}/download?path=yok.txt`)).statusCode).toBe(404);
    expect((await get(a, `/code/sessions/${s.chatId}/download?path=site`)).statusCode).toBe(400);
    expect((await get(b, `/code/sessions/${s.chatId}/download?path=site/app.js`)).statusCode).toBe(404);
    expect((await get(a, `/code/sessions/${s.chatId}/download`)).statusCode).toBe(400);
  });

  it('yükleme: .sixfinger/uploads altına yazılır, ad temizlenir, boş/aşırı büyük reddedilir, git dışında tutulur', async () => {
    const { a, s } = await withSite();
    const up = await post(a, `/code/sessions/${s.chatId}/upload`, { name: '../../evil/Logo Ö.png', dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64') });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toEqual({ path: '.sixfinger/uploads/Logo Ö.png', name: 'Logo Ö.png', bytes: 4 });
    expect(fc.state.uploads).toEqual([{ path: '.sixfinger/uploads/Logo Ö.png', bytes: 4 }]);
    expect(fc.state.execs.some((c) => c.includes('.git/info/exclude') && c.includes('.sixfinger/'))).toBe(true);
    expect((await post(a, `/code/sessions/${s.chatId}/upload`, { name: '.gizli', dataBase64: 'AQ==' })).json().name).toBe('gizli');
    expect((await post(a, `/code/sessions/${s.chatId}/upload`, { name: 'x', dataBase64: '' })).statusCode).toBe(400);
    env.ctx.config.codeAllowed.emails.add('up-other@example.com');
    const b = await member(env, { email: 'up-other@example.com' });
    expect((await post(b, `/code/sessions/${s.chatId}/upload`, { name: 'x', dataBase64: 'AQ==' })).statusCode).toBe(404);
  });
});
