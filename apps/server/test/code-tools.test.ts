import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/lib/types.ts';
import { FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient } from '../src/services/tools/code-client.ts';
import { createCodeTools, tailTrim } from '../src/services/tools/code.ts';
import { repairArgs } from '../src/services/tools/repair.ts';
import { runToolCall, type ToolContext, type ToolDef } from '../src/services/tools/index.ts';
import type { ExecOutcome } from '../src/services/tools/sandbox.ts';

const user = { id: 'u1', limits: { features: { sandbox: true } } } as unknown as AuthUser;

function fake(initial: Record<string, string> = {}) {
  const fs = new Map(Object.entries(initial));
  const state = { needPrepare: false, prepareCalls: 0, execs: [] as string[], exec: (_c: string): Partial<ExecOutcome & { diskUsedMb: number }> => ({}), globFiles: [] as string[], grepLines: [] as string[], truncatedRead: false };
  const client: CodeSandboxClient = {
    async prepare() {
      state.prepareCalls++;
      state.needPrepare = false;
      return { cloned: false, setupRan: false, setupOk: null, setupOutput: '', baseSha: 'abc', branch: 'b', diskUsedMb: 0, diskMb: 512 };
    },
    async exec(_s, command) {
      if (state.needPrepare) throw new NotPreparedError();
      state.execs.push(command);
      const custom = state.exec(command);
      const syn = /^node --check '(.+)'$/.exec(command);
      if (syn && fs.get(syn[1]!)?.includes('SYNTAX_ERROR')) return { exitCode: 1, stdout: '', stderr: 'SyntaxError: Unexpected token', truncated: false, timedOut: false, durationMs: 5, diskUsedMb: 1 };
      const ls = /^ls -1Ap -- '(.+)' \| head/.exec(command);
      if (ls) return { exitCode: 0, stdout: [...fs.keys()].filter((k) => k.startsWith(`${ls[1]}/`)).map((k) => k.slice(ls[1]!.length + 1)).join('\n'), stderr: '', truncated: false, timedOut: false, durationMs: 2, diskUsedMb: 1 };
      return { exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, durationMs: 120, diskUsedMb: 1, ...custom };
    },
    async read(_s, path) {
      if (state.needPrepare) throw new NotPreparedError();
      if (fs.has(path)) return { content: fs.get(path)!, truncated: state.truncatedRead };
      if ([...fs.keys()].some((k) => k.startsWith(`${path}/`))) throw new IsDirectoryError();
      throw new FileNotFoundError();
    },
    async write(_s, path, content) {
      if (state.needPrepare) throw new NotPreparedError();
      fs.set(path, content);
      return { bytes: content.length, diskUsedMb: 1 };
    },
    async glob() {
      return { files: state.globFiles, truncated: false };
    },
    async grep() {
      return { lines: state.grepLines, truncated: false };
    },
    async changes() {
      return { files: [], additions: 0, deletions: 0, baseSha: 'abc', headSha: 'abc', ahead: 0, uncommitted: 0, subject: '' };
    },
    async checkpoint() {
      return { head: 'a'.repeat(40), snapshot: 'd'.repeat(40) };
    },
    async archive() {
      return Buffer.alloc(0);
    },
    async push() {
      return { sha: 'a'.repeat(40), branch: 'x', output: '' };
    },
    async raw() {
      throw new Error('raw: bu sahtede yok');
    },
    async ports() {
      return [];
    },
    async http() {
      throw new Error('http: bu sahtede yok');
    },
    async upload() {
      throw new Error('upload: bu sahtede yok');
    },
    async usage() {
      return { diskUsedMb: 1, diskMb: 512, running: true };
    },
    async destroy() {},
  };
  const tools = createCodeTools(client);
  const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
    user,
    signal: new AbortController().signal,
    chatId: 'c1',
    code: { session: 'u1:c1', diskMb: 512, prepare: async () => void (await client.prepare({} as never, new AbortController().signal)) },
    ...over,
  });
  const call = (name: string, args: unknown, c = ctx()) => runToolCall(tools as ToolDef[], { id: 'x', type: 'function', function: { name, arguments: JSON.stringify(args) } }, c);
  return { fs, state, tools, call, ctx };
}

describe('argüman onarımı', () => {
  const schema = { properties: { path: { type: 'string' }, offset: { type: 'integer' }, all: { type: 'boolean' }, todos: { type: 'array' }, opts: { type: 'object' }, name: { type: 'string' } }, required: ['path'] };
  it('metin olarak gelen sayı/mantıksal/JSON değerleri düzeltir', () => {
    expect(repairArgs(schema, { path: 'a', offset: '20', all: 'false', todos: '[{"a":1}]', opts: '{"x":1}' })).toEqual({ path: 'a', offset: 20, all: false, todos: [{ a: 1 }], opts: { x: 1 } });
    expect(repairArgs(schema, { path: 'a', offset: 3.7 })).toMatchObject({ offset: 4 });
    expect(repairArgs(schema, { path: 'a', name: 42 })).toMatchObject({ name: '42' });
  });
  it('yer tutucuları atar, zorunlu alana dokunmaz', () => {
    expect(repairArgs(schema, { path: 'a', offset: null, opts: {}, all: null })).toEqual({ path: 'a' });
    expect(repairArgs(schema, { path: null })).toEqual({ path: null });
  });
  it('takma adları asıl ada çevirir, asıl ad varsa ezmez', () => {
    expect(repairArgs(schema, { file_path: 'x.ts' }, { path: ['file_path', 'filePath'] })).toEqual({ path: 'x.ts' });
    expect(repairArgs(schema, { path: 'a', file_path: 'b' }, { path: ['file_path'] })).toEqual({ path: 'a' });
  });
  it('bozuk JSON metnine dokunmaz (doğrulama hatası olarak döner)', () => {
    expect(repairArgs(schema, { path: 'a', todos: '[bozuk' })).toMatchObject({ todos: '[bozuk' });
  });
});

describe('araç çağırma (genel)', () => {
  it('bilinmeyen araç: kullanılabilir araçları sayar', async () => {
    const { call } = fake();
    const r = await call('rm_rf', {});
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/bash, job_output, job_kill, read, write, edit, glob, grep, todo/);
  });
  it('geçersiz argüman: İngilizce, açık ve düzeltmeye yönlendirir', async () => {
    const { call } = fake();
    const r = await call('edit', { path: 'a.ts' });
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/Invalid arguments for tool "edit"/);
    expect(r.output).toMatch(/new_string/);
    expect(r.output).toMatch(/call the tool again/);
  });
  it('model "file_path", "oldString", "limit":"5" gibi hataları yapsa da çalışır', async () => {
    const { call, fs } = fake({ 'a.txt': 'bir\niki\nüç\n' });
    expect((await call('read', { file_path: 'a.txt', limit: '2' })).output).toContain('2: iki');
    const e = await call('edit', { filePath: 'a.txt', oldString: 'iki', newString: 'İKİ' });
    expect(e.status).toBe('done');
    expect(fs.get('a.txt')).toBe('bir\nİKİ\nüç\n');
  });
  it('Code oturumu olmadan çalışmaz', async () => {
    const { call, ctx } = fake({ 'a.txt': 'x' });
    const r = await call('read', { path: 'a.txt' }, { ...ctx(), code: undefined });
    expect(r.output).toMatch(/only works inside a Code session/);
  });
  it('sandboxd yeniden başlamışsa çalışma alanını hazırlayıp bir kez yeniden dener', async () => {
    const { call, state } = fake({ 'a.txt': 'merhaba\n' });
    state.needPrepare = true;
    const r = await call('read', { path: 'a.txt' });
    expect(r.status).toBe('done');
    expect(state.prepareCalls).toBe(1);
    expect(r.output).toContain('1: merhaba');
  });
});

describe('read', () => {
  const big = Array.from({ length: 2_500 }, (_, i) => `satır ${i + 1}`).join('\n') + '\n';
  it('satır numaralı çıktı, offset ve limit', async () => {
    const { call } = fake({ 'a.txt': 'bir\niki\nüç\ndört\n' });
    const r = await call('read', { path: 'a.txt', offset: 2, limit: 2 });
    expect(r.output).toBe('File: a.txt (4 lines)\n2: iki\n3: üç\n[Output truncated. 1 more lines. Continue reading with offset: 4]');
    expect(r.meta).toEqual({ path: 'a.txt', lines: 4 });
  });
  it('2000 satırda keser ve devam için offset söyler', async () => {
    const { call } = fake({ 'big.txt': big });
    const r = await call('read', { path: 'big.txt' });
    expect(r.output).toContain('2000: satır 2000');
    expect(r.output).not.toContain('2001: ');
    expect(r.output).toContain('Continue reading with offset: 2001');
  });
  it('çok uzun satırı kırpar, dosya sonunu aşan offset hata verir', async () => {
    const { call } = fake({ 'w.txt': `${'x'.repeat(5_000)}\nkısa\n` });
    expect((await call('read', { path: 'w.txt' })).output).toContain('(line truncated to 2000 chars)');
    const r = await call('read', { path: 'w.txt', offset: 9 });
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/past the end/);
  });
  it('klasörü listeler', async () => {
    const { call } = fake({ 'src/a.ts': '1', 'src/b.ts': '2' });
    const r = await call('read', { path: 'src' });
    expect(r.output).toBe('Directory: src\na.ts\nb.ts');
  });
  it('olmayan dosyada benzer adları önerir', async () => {
    const { call, state } = fake({ 'src/util.ts': '1' });
    state.globFiles = ['src/util.ts'];
    const r = await call('read', { path: 'util.tsx' });
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/File not found: util\.tsx/);
    expect(r.output).toMatch(/Did you mean one of these\?\nsrc\/util\.ts/);
  });
});

describe('write', () => {
  it('yeni dosya ve üzerine yazma; +N −M ve meta', async () => {
    const { call, fs } = fake();
    const a = await call('write', { path: 'a/b.txt', content: 'bir\niki\n' });
    expect(a.output).toBe('Created a/b.txt (2 lines, +2 −0)');
    expect(a.meta).toEqual({ files: [{ path: 'a/b.txt', additions: 2, deletions: 0, status: 'added' }] });
    const b = await call('write', { path: 'a/b.txt', content: 'bir\nÜÇ\ndört\n' });
    expect(b.output).toBe('Wrote a/b.txt (3 lines, +2 −1)');
    expect(b.summary).toBe('+2 −1');
    expect(fs.get('a/b.txt')).toBe('bir\nÜÇ\ndört\n');
  });
  it('sözdizimi hatasını aynı sonuçta bildirir', async () => {
    const { call } = fake();
    const r = await call('write', { path: 'x.js', content: 'SYNTAX_ERROR (' });
    expect(r.status).toBe('done');
    expect(r.output).toMatch(/⚠ Syntax check failed \(exit 1\):\nSyntaxError/);
  });
  it('çok büyük içerik reddedilir', async () => {
    const { call } = fake();
    const r = await call('write', { path: 'x.txt', content: 'x'.repeat(2_000_100) });
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/too large/);
  });
});

describe('edit', () => {
  const src = 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n';
  it('değiştirir, kesit gösterir, +N −M ve meta döner', async () => {
    const { call, fs } = fake({ 'm.ts': src });
    const r = await call('edit', { path: 'm.ts', old_string: '  return 2;', new_string: '  return 20;\n  // yeni' });
    expect(r.status).toBe('done');
    expect(fs.get('m.ts')).toContain('  return 20;\n  // yeni\n}');
    expect(r.output).toMatch(/^Edited m\.ts \(1 replacement, \+2 −1\)\n/);
    expect(r.output).toContain('6:   return 20;');
    expect(r.meta).toEqual({ files: [{ path: 'm.ts', additions: 2, deletions: 1, status: 'modified', replacements: 1 }] });
  });
  it('birden çok eşleşme: hata; replace_all: hepsi', async () => {
    const { call, fs } = fake({ 'm.ts': 'x\nx\n' });
    const e = await call('edit', { path: 'm.ts', old_string: 'x', new_string: 'y' });
    expect(e.status).toBe('error');
    expect(e.output).toMatch(/Found 2 matches/);
    expect(fs.get('m.ts')).toBe('x\nx\n');
    expect((await call('edit', { path: 'm.ts', old_string: 'x', new_string: 'y', replace_all: true })).status).toBe('done');
    expect(fs.get('m.ts')).toBe('y\ny\n');
  });
  it('eşleşmezse en benzer gerçek satırı gösterir ve dosyaya dokunmaz', async () => {
    const { call, fs } = fake({ 'm.ts': src });
    const r = await call('edit', { path: 'm.ts', old_string: '  return  2 ;', new_string: '  return 3;' });
    expect(r.status).toBe('error');
    expect(r.output).toMatch(/closest text in the file/);
    expect(r.output).toContain('6:   return 2;');
    expect(fs.get('m.ts')).toBe(src);
  });
  it('olmayan dosyada write\'a yönlendirir', async () => {
    const { call } = fake();
    const r = await call('edit', { path: 'yok.ts', old_string: 'a', new_string: 'b' });
    expect(r.output).toMatch(/File not found: yok\.ts\. To create a new file use the write tool/);
  });
  it('düzenleme sonrası sözdizimi hatasını bildirir', async () => {
    const { call } = fake({ 'a.js': 'let a = 1;\n' });
    const r = await call('edit', { path: 'a.js', old_string: 'let a = 1;', new_string: 'let a = SYNTAX_ERROR;' });
    expect(r.status).toBe('done');
    expect(r.output).toMatch(/Syntax check failed/);
  });
  it('çok büyük (kesilmiş) dosyayı düzenlemeyi reddeder', async () => {
    const { call, state } = fake({ 'huge.txt': 'x' });
    state.truncatedRead = true;
    expect((await call('edit', { path: 'huge.txt', old_string: 'x', new_string: 'y' })).output).toMatch(/too large to edit/);
  });
  it('aynı dosyaya eşzamanlı iki düzenleme sırayla uygulanır (kayıp güncelleme yok)', async () => {
    const { call, fs } = fake({ 'p.txt': 'a\nb\nc\n' });
    const [x, y] = await Promise.all([
      call('edit', { path: 'p.txt', old_string: 'a', new_string: 'A' }),
      call('edit', { path: 'p.txt', old_string: 'c', new_string: 'C' }),
    ]);
    expect([x.status, y.status]).toEqual(['done', 'done']);
    expect(fs.get('p.txt')).toBe('A\nb\nC\n');
  });
});

describe('bash', () => {
  it('çıkış kodu, süre ve çıktıyı biçimler', async () => {
    const { call, state } = fake();
    state.exec = () => ({ stdout: 'merhaba\n', stderr: 'uyarı\n', exitCode: 0, durationMs: 1_234 });
    const r = await call('bash', { command: 'echo merhaba' });
    expect(r.output).toBe('$ echo merhaba\n[exit code 0 · 1.2s]\nmerhaba\n[stderr]\nuyarı');
    expect(r.summary).toBe('exit 0 · 1.2s');
    expect(r.meta).toMatchObject({ exitCode: 0, command: 'echo merhaba' });
  });
  it('uzun çıktının SONUNU gösterir (hata sonda olur) ve kaç satır atıldığını söyler', async () => {
    const { call, state } = fake();
    const lines = Array.from({ length: 3_000 }, (_, i) => `log satırı ${i + 1} ${'x'.repeat(20)}`);
    state.exec = () => ({ stdout: `${lines.join('\n')}\nASIL HATA: derleme başarısız\n`, exitCode: 1 });
    const r = await call('bash', { command: 'npm run build' });
    expect(r.output).toContain('ASIL HATA: derleme başarısız');
    expect(r.output).not.toContain('log satırı 1 ');
    expect(r.output).toMatch(/output truncated: showing the last \d+ of 3001 lines/);
    expect(r.output.length).toBeLessThan(17_500);
  });
  it('zaman aşımını açıklar', async () => {
    const { call, state } = fake();
    state.exec = () => ({ exitCode: null, timedOut: true, durationMs: 120_000 });
    const r = await call('bash', { command: 'npm test' });
    expect(r.output).toMatch(/timed out after 120s.*timeout_seconds/);
  });
  it('platformun yönettiği git komutlarını engeller, salt okunurlara izin verir', async () => {
    const { call, state } = fake();
    for (const cmd of ['git push origin main', 'cd a && git rebase main', 'echo a; git branch -D x', 'git -C . remote add o u', 'git config user.name x', 'git switch main', 'git merge x']) {
      const r = await call('bash', { command: cmd });
      expect(r.status, cmd).toBe('error');
      expect(r.output).toMatch(/managed by the platform/);
    }
    expect(state.execs).toEqual([]);
    for (const cmd of ['git status', 'git add a.txt', 'git commit -m x', 'cd a && git add -A && git commit -m "feat: y"', 'git diff --stat', 'git log -5 --oneline', 'git show HEAD', 'echo "git push" | cat', 'grep -r "git commit" docs']) {
      expect((await call('bash', { command: cmd })).status, cmd).toBe('done');
    }
  });
  it('arka planda başlatır: betik base64 ile yazılır, log yolu döner', async () => {
    const { call, state } = fake();
    state.exec = () => ({ stdout: 'Server listening on :3000\n' });
    const r = await call('bash', { command: 'npm run dev', background: true });
    expect(r.status).toBe('done');
    expect(state.execs[0]).toMatch(/base64 -d > \/tmp\/sf-bg-[0-9a-f]{6}\.sh.*setsid nohup bash .*< \/dev\/null &/);
    expect(state.execs[0]).toContain(Buffer.from('npm run dev').toString('base64'));
    expect(r.output).toMatch(/Started background job [0-9a-f]{6}\. Log file: \/tmp\/sf-bg-/);
    expect(r.output).toContain('Server listening on :3000');
    expect(r.meta).toMatchObject({ background: true });
  });
  it('disk %80 üzerindeyse uyarır', async () => {
    const { call, state } = fake();
    state.exec = () => ({ diskUsedMb: 450 });
    expect((await call('bash', { command: 'ls' })).output).toMatch(/\[disk: 450 \/ 512 MB used/);
  });
});

describe('glob, grep, todo', () => {
  it('glob', async () => {
    const { call, state } = fake();
    state.globFiles = ['a.ts', 'src/b.ts'];
    expect((await call('glob', { pattern: '**/*.ts' })).output).toBe('2 files\na.ts\nsrc/b.ts');
    state.globFiles = [];
    expect((await call('glob', { pattern: 'x' })).output).toMatch(/No files matched/);
  });
  it('grep: dosyaya göre gruplar', async () => {
    const { call, state } = fake();
    state.grepLines = ['a.ts:3:const topla = 1;', 'a.ts:9:topla(2)', 'src/b.ts:1:import { topla }'];
    const r = await call('grep', { pattern: 'topla' });
    expect(r.output).toBe('Found 3 matches in 2 files\na.ts\n  Line 3: const topla = 1;\n  Line 9: topla(2)\nsrc/b.ts\n  Line 1: import { topla }');
    state.grepLines = [];
    expect((await call('grep', { pattern: 'yok' })).output).toBe('No matches found.');
  });
  it('todo: listeyi meta olarak döndürür, JSON metni olarak gelse de çalışır', async () => {
    const { call } = fake();
    const r = await call('todo', { todos: [{ content: 'Testleri yaz', status: 'completed' }, { content: 'Kodu düzelt', status: 'in_progress' }, { content: 'PR aç', status: 'pending' }] });
    expect(r.output).toMatch(/3 items \(1 completed, 1 in progress, 1 pending\)/);
    expect(r.meta?.todos).toHaveLength(3);
    const s = await call('todo', { todos: JSON.stringify([{ content: 'a', status: 'pending' }]) });
    expect(s.status).toBe('done');
    const bad = await call('todo', { todos: [{ content: 'a', status: 'bilinmeyen' }] });
    expect(bad.status).toBe('error');
  });
});

describe('tailTrim', () => {
  it('satır sınırında keser', () => {
    const t = tailTrim(Array.from({ length: 100 }, (_, i) => `satır ${i}`).join('\n'), 100);
    expect(t.text.startsWith('satır')).toBe(true);
    expect(t.omittedLines).toBeGreaterThan(80);
    expect(tailTrim('kısa', 100)).toEqual({ text: 'kısa', omittedLines: 0 });
  });
});
