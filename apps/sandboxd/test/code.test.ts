import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CodeService, codeSessionId, globToRegExp, parseCurlResponse, parseListeningPorts, type PrepareRequest } from '../src/code.ts';
import { loadConfig } from '../src/config.ts';
import { LocalRuntime } from '../src/runtime/local.ts';
import { buildServer } from '../src/server.ts';
import { SandboxService } from '../src/service.ts';
import { quiet } from './helpers.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

let tmp: string;
let origin: string;

function makeCode(over: Record<string, string> = {}, now?: () => number) {
  const cfg = loadConfig({
    SANDBOXD_TOKEN: 'test-token-test-token-test-token',
    SANDBOX_RUNTIME: 'local-unsafe',
    SANDBOX_DATA_DIR: join(tmp, 'chat'),
    CODE_DATA_DIR: join(tmp, 'code'),
    ...over,
  } as NodeJS.ProcessEnv);
  const runtime = new LocalRuntime(join(tmp, 'local-chat'));
  const code = new CodeService(cfg, runtime, null, quiet, now);
  return { cfg, runtime, code };
}

const req = (over: Partial<PrepareRequest> = {}): PrepareRequest => ({
  user: 'u1',
  session: 'u1:chat1',
  repo: 'octo/alpha',
  baseBranch: 'main',
  workBranch: 'sixfinger/alpha-abc123',
  network: { mode: 'none', domains: [] },
  diskMb: 64,
  setupScript: '',
  env: {},
  cloneUrl: origin,
  ...over,
});

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sf-code-test-'));
  origin = join(tmp, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  writeFileSync(join(origin, 'app.js'), "const a = 1;\nconsole.log('merhaba');\n");
  mkdirSync(join(origin, 'src'));
  writeFileSync(join(origin, 'src', 'util.ts'), 'export const topla = (a: number, b: number) => a + b;\n');
  writeFileSync(join(origin, '.gitignore'), 'ignored.txt\n');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'ilk');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => rmSync(join(tmp, 'code'), { recursive: true, force: true }));

describe('glob kalıpları', () => {
  const m = (g: string, p: string) => globToRegExp(g).test(p);
  it('eşleştirir', () => {
    expect(m('**/*.ts', 'src/a/b.ts')).toBe(true);
    expect(m('**/*.ts', 'b.ts')).toBe(true);
    expect(m('*.ts', 'src/b.ts')).toBe(true); // eğik çizgisiz kalıp her dizinde
    expect(m('src/*.ts', 'src/b.ts')).toBe(true);
    expect(m('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(m('src/**', 'src/a/b.ts')).toBe(true);
    expect(m('*.{ts,tsx}', 'x/y.tsx')).toBe(true);
    expect(m('*.{ts,tsx}', 'x/y.js')).toBe(false);
    expect(m('file?.txt', 'file1.txt')).toBe(true);
    expect(m('[ab].js', 'a.js')).toBe(true);
    expect(m('a.b', 'aXb')).toBe(false);
    expect(m('package.json', 'apps/web/package.json')).toBe(true);
    expect(m('(x).js', '(x).js')).toBe(true);
  });
});

describe('çalışma alanı hazırlığı', () => {
  it('klonlar, çalışma branch\'ini açar, kimliği ve başlangıç commit\'ini kaydeder', async () => {
    const { code, cfg } = makeCode();
    const r = await code.prepare(req());
    expect(r.cloned).toBe(true);
    expect(r.branch).toBe('sixfinger/alpha-abc123');
    expect(r.baseSha).toMatch(/^[0-9a-f]{40}$/);
    const dir = join(cfg.CODE_DATA_DIR, 'workspaces', codeSessionId('u1:chat1'));
    expect(existsSync(join(dir, 'app.js'))).toBe(true);
    expect(readFileSync(join(dir, '.git', 'sixfinger', 'base'), 'utf8').trim()).toBe(r.baseSha);
    expect(execFileSync('git', ['config', 'user.email'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('noreply@sixfinger.live');
    expect(execFileSync('git', ['config', 'user.name'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('SixFinger Code');
    // remote adresine token yazılmaz
    expect(git(dir, 'remote', 'get-url', 'origin')).not.toMatch(/x-access-token|gho_/);
  });

  it('commit yazarı kullanıcının kimliğidir (verilmişse)', async () => {
    const { code, cfg } = makeCode();
    await code.prepare(req({ author: { name: 'octo', email: '42+octo@users.noreply.github.com' } }));
    await code.writeFile('u1', 'u1:chat1', 'x.txt', 'x');
    await code.commit('u1', 'u1:chat1', 'deneme\n\nCo-Authored-By: SixFinger Code <noreply@sixfinger.live>');
    const dir = join(cfg.CODE_DATA_DIR, 'workspaces', codeSessionId('u1:chat1'));
    expect(execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('octo <42+octo@users.noreply.github.com>');
    expect(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' })).toContain('Co-Authored-By: SixFinger Code <noreply@sixfinger.live>');
  });

  it('ikinci hazırlıkta yeniden klonlamaz; kurulum betiği içeriği değişmedikçe bir kez çalışır', async () => {
    const { code } = makeCode();
    const a = await code.prepare(req({ setupScript: 'echo kuruldu > kurulum.txt' }));
    expect(a).toMatchObject({ cloned: true, setupRan: true, setupOk: true });
    const b = await code.prepare(req({ setupScript: 'echo kuruldu > kurulum.txt' }));
    expect(b).toMatchObject({ cloned: false, setupRan: false, setupOk: null });
    const c = await code.prepare(req({ setupScript: 'echo yeni > kurulum.txt' }));
    expect(c.setupRan).toBe(true);
  });

  it('başarısız kurulum betiği bildirilir ve tekrar denenir', async () => {
    const { code } = makeCode();
    const a = await code.prepare(req({ setupScript: 'echo hata >&2; exit 3' }));
    expect(a.setupOk).toBe(false);
    expect(a.setupOutput).toContain('hata');
    const b = await code.prepare(req({ setupScript: 'echo hata >&2; exit 3' }));
    expect(b.setupRan).toBe(true);
  });

  it('token yoksa ve klon yoksa not_prepared; var olmayan repo temiz hata verir', async () => {
    const { code } = makeCode();
    await expect(code.prepare(req({ cloneUrl: undefined, token: undefined }))).rejects.toMatchObject({ code: 'not_prepared' });
    await expect(code.prepare(req({ cloneUrl: join(tmp, 'yok') }))).rejects.toThrow(/klonlanamadı/);
    // başarısız klondan sonra yarım .git kalmaz; doğru adresle yeniden denenebilir
    await expect(code.prepare(req())).resolves.toMatchObject({ cloned: true });
  });

  it('geçersiz repo ve branch adları reddedilir', async () => {
    const { code } = makeCode();
    for (const bad of [{ repo: '../etc' }, { repo: 'a/b/c' }, { baseBranch: '--upload-pack=x' }, { baseBranch: 'a..b' }, { workBranch: '-x' }, { workBranch: 'a b' }])
      await expect(code.prepare(req(bad as Partial<PrepareRequest>))).rejects.toThrow(/Geçersiz/);
  });

  it('cloneUrl yalnızca local-unsafe çalıştırıcıda kabul edilir', async () => {
    const { code } = makeCode({ SANDBOX_RUNTIME: 'docker' });
    await expect(code.prepare(req())).rejects.toThrow(/yalnızca testlerde/);
  });

  it('başka kullanıcının çalışma alanına erişilemez', async () => {
    const { code } = makeCode();
    await code.prepare(req());
    await expect(code.prepare(req({ user: 'u2' }))).rejects.toThrow(/başka bir kullanıcıya/);
    await expect(code.exec('u2', 'u1:chat1', 'ls')).rejects.toMatchObject({ code: 'not_prepared' });
    await expect(code.destroy('u2', 'u1:chat1')).rejects.toThrow(/başka bir kullanıcıya/);
  });
});

describe('işlemler', () => {
  const ready = async (over: Record<string, string> = {}, r: Partial<PrepareRequest> = {}) => {
    const m = makeCode(over);
    await m.code.prepare(req(r));
    return m;
  };

  it('hazırlanmadan işlem not_prepared döner', async () => {
    const { code } = makeCode();
    await expect(code.exec('u1', 'u1:yok', 'ls')).rejects.toMatchObject({ code: 'not_prepared' });
  });

  it('exec, read, write ve klasör açma', async () => {
    const { code } = await ready();
    const out = await code.exec('u1', 'u1:chat1', 'cat app.js && pwd');
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("console.log('merhaba')");
    const w = await code.writeFile('u1', 'u1:chat1', 'yeni/klasor/dosya.txt', 'merhaba dünya');
    expect(w.bytes).toBe(Buffer.byteLength('merhaba dünya'));
    expect((await code.readFile('u1', 'u1:chat1', 'yeni/klasor/dosya.txt')).content).toBe('merhaba dünya');
    expect((await code.readFile('u1', 'u1:chat1', '/work/app.js')).content).toContain('const a = 1');
    await expect(code.readFile('u1', 'u1:chat1', 'yok.txt')).rejects.toMatchObject({ code: 'not_found' });
    await expect(code.readFile('u1', 'u1:chat1', 'src')).rejects.toThrow(/klasör/);
  });

  it('yol kaçışı ve .git yazımı engellenir', async () => {
    const { code } = await ready();
    await expect(code.readFile('u1', 'u1:chat1', '../origin/app.js')).rejects.toThrow(/dışına/);
    await expect(code.writeFile('u1', 'u1:chat1', '/etc/passwd', 'x')).rejects.toThrow(/\/work/);
    await expect(code.writeFile('u1', 'u1:chat1', '.git/hooks/pre-commit', 'x')).rejects.toThrow(/\.git/);
    await expect(code.writeFile('u1', 'u1:chat1', './.git/config', 'x')).rejects.toThrow(/\.git/);
  });

  it('büyük dosya reddedilir', async () => {
    const { code } = await ready({ CODE_FILE_MAX_BYTES: '2048' });
    await expect(code.writeFile('u1', 'u1:chat1', 'b.txt', 'x'.repeat(3000))).rejects.toMatchObject({ code: 'too_large' });
  });

  it('glob ve grep (ripgrep) .gitignore ve .git\'e uyar', async () => {
    const { code } = await ready();
    await code.writeFile('u1', 'u1:chat1', 'ignored.txt', 'gizli');
    const g = await code.glob('u1', 'u1:chat1', '**/*.ts');
    expect(g.files).toEqual(['src/util.ts']);
    const all = await code.glob('u1', 'u1:chat1', '*');
    expect(all.files).toContain('app.js');
    expect(all.files).not.toContain('ignored.txt');
    expect(all.files.some((f) => f.startsWith('.git/'))).toBe(false);
    const hit = await code.grep('u1', 'u1:chat1', { pattern: 'topla', literal: true });
    expect(hit.lines).toEqual(['src/util.ts:1:export const topla = (a: number, b: number) => a + b;']);
    const none = await code.grep('u1', 'u1:chat1', { pattern: 'yoktur-böyle-bir-şey' });
    expect(none.lines).toEqual([]);
    await expect(code.grep('u1', 'u1:chat1', { pattern: '(' })).rejects.toThrow(/geçersiz/);
    const limited = await code.grep('u1', 'u1:chat1', { pattern: 'a', limit: 1 });
    expect(limited.lines).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('değişiklikler (+N −M) ve commit', async () => {
    const { code } = await ready();
    expect((await code.changes('u1', 'u1:chat1')).files).toEqual([]);
    await code.writeFile('u1', 'u1:chat1', 'app.js', "const a = 2;\nconsole.log('merhaba');\nconsole.log('yeni');\n");
    await code.writeFile('u1', 'u1:chat1', 'notlar.md', '# not\nbir\niki\n');
    await code.exec('u1', 'u1:chat1', 'rm src/util.ts');
    const ch = await code.changes('u1', 'u1:chat1');
    const by = Object.fromEntries(ch.files.map((f) => [f.path, f]));
    expect(by['app.js']).toMatchObject({ status: 'modified', additions: 2, deletions: 1 });
    expect(by['notlar.md']).toMatchObject({ status: 'added', additions: 3, deletions: 0 });
    expect(by['src/util.ts']).toMatchObject({ status: 'deleted', additions: 0, deletions: 1 });
    expect(ch).toMatchObject({ additions: 5, deletions: 2 });

    const c = await code.commit('u1', 'u1:chat1', 'özellik: örnek');
    expect(c.sha).toMatch(/^[0-9a-f]{40}$/);
    // commit sonrası da başlangıca göre fark sürer
    expect((await code.changes('u1', 'u1:chat1')).additions).toBe(5);
    // değişiklik yoksa commit atılmaz
    expect((await code.commit('u1', 'u1:chat1', 'boş')).sha).toBeNull();
  });

  it('git hook\'ları çalışmaz (model .git/hooks yazamaz, commit hook\'u kapalı)', async () => {
    const { code, cfg } = await ready();
    const dir = join(cfg.CODE_DATA_DIR, 'workspaces', codeSessionId('u1:chat1'));
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ntouch /tmp/hook-ran-sf-test\nexit 1\n', { mode: 0o755 });
    await code.writeFile('u1', 'u1:chat1', 'x.txt', 'x');
    const c = await code.commit('u1', 'u1:chat1', 'hook denemesi');
    expect(c.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync('/tmp/hook-ran-sf-test')).toBe(false);
  });
});

describe('disk kotası', () => {
  it('kota dolunca yazma reddedilir; temizlik komutları yine çalışır', async () => {
    const m = makeCode();
    await m.code.prepare(req({ diskMb: 64 }));
    // 100 MB'lık dosya oluştur (kotanın %156'sı): exec izinli, sonra ölçülür
    const big = await m.code.exec('u1', 'u1:chat1', 'head -c 104857600 /dev/zero > buyuk.bin; echo tamam');
    expect(big.diskUsedMb).toBeGreaterThan(64);
    await expect(m.code.writeFile('u1', 'u1:chat1', 'a.txt', 'x')).rejects.toMatchObject({ code: 'disk_full' });
    await expect(m.code.exec('u1', 'u1:chat1', 'npm install')).rejects.toMatchObject({ code: 'disk_full' });
    // temizlik serbest
    const rm = await m.code.exec('u1', 'u1:chat1', 'rm buyuk.bin');
    expect(rm.exitCode).toBe(0);
    const u = await m.code.usage('u1', 'u1:chat1');
    expect(u.diskUsedMb).toBeLessThan(64);
    await expect(m.code.writeFile('u1', 'u1:chat1', 'a.txt', 'x')).resolves.toBeTruthy();
  }, 30_000);
});

describe('havuz ve temizlik', () => {
  it('konteyner sınırı dolunca boşta olan eski oturum kapatılır', async () => {
    const m = makeCode({ CODE_MAX_CONTAINERS: '1' });
    await m.code.prepare(req({ session: 'u1:a' }));
    expect(m.code.stats().running).toBe(1);
    await m.code.prepare(req({ session: 'u1:b' }));
    expect(m.code.stats()).toMatchObject({ running: 1, known: 2 });
    // kapatılan oturum yeniden çalıştırılabilir (çalışma alanı diskte)
    const r = await m.code.exec('u1', 'u1:a', 'echo hâlâ var; ls app.js');
    expect(r.stdout).toContain('app.js');
    expect(m.code.stats().running).toBe(1);
  });

  it('boşta kalan konteyner kapanır, çalışma alanı kalır; süresi dolan çalışma alanı silinir', async () => {
    let t = Date.now();
    const m = makeCode({ CODE_IDLE_SECONDS: '5', CODE_WORKSPACE_TTL_DAYS: '1' }, () => t);
    await m.code.prepare(req());
    t += 6_000;
    expect(await m.code.reapIdle()).toBe(1);
    expect(m.code.stats().running).toBe(0);
    expect((await m.code.exec('u1', 'u1:chat1', 'ls')).exitCode).toBe(0); // yeniden başlar
    // etkin oturumun çalışma alanı süpürülmez
    t += 3 * 86_400_000;
    expect(await m.code.sweepWorkspaces()).toBe(0);
    // sandboxd yeniden başlamış gibi: durum kaybı, çalışma alanı eskimiş
    const m2 = makeCode({ CODE_WORKSPACE_TTL_DAYS: '1' }, () => t);
    expect(await m2.code.sweepWorkspaces()).toBe(1);
  });

  it('destroy çalışma alanını siler', async () => {
    const { code, cfg } = makeCode();
    await code.prepare(req());
    const dir = join(cfg.CODE_DATA_DIR, 'workspaces', codeSessionId('u1:chat1'));
    expect(existsSync(dir)).toBe(true);
    await code.destroy('u1', 'u1:chat1');
    expect(existsSync(dir)).toBe(false);
    await expect(code.exec('u1', 'u1:chat1', 'ls')).rejects.toMatchObject({ code: 'not_prepared' });
  });
});

describe('HTTP uçları', () => {
  it('prepare → exec → write → changes → commit akışı ve hata kodları', async () => {
    const { code, cfg, runtime } = makeCode();
    const svc = new SandboxService(cfg, runtime, quiet);
    const app = buildServer(svc, cfg, { logger: false, code });
    const h = { authorization: 'Bearer test-token-test-token-test-token' };
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: h, payload });
    const who = { user: 'u1', session: 'u1:http' };

    expect((await post('/v1/code/exec', { ...who, command: 'ls' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/v1/code/exec', payload: { ...who, command: 'ls' } })).statusCode).toBe(401);
    const prep = await post('/v1/code/prepare', { ...who, repo: 'octo/alpha', base_branch: 'main', work_branch: 'sixfinger/x-1', network: { mode: 'none', domains: [] }, disk_mb: 64, clone_url: origin });
    expect(prep.statusCode).toBe(200);
    expect(prep.json()).toMatchObject({ cloned: true, branch: 'sixfinger/x-1' });
    const ex = await post('/v1/code/exec', { ...who, command: 'echo selam' });
    expect(ex.json()).toMatchObject({ exitCode: 0, stdout: 'selam\n' });
    expect((await post('/v1/code/write', { ...who, path: 'a.txt', content: 'x' })).statusCode).toBe(200);
    expect((await post('/v1/code/write', { ...who, path: '.git/config', content: 'x' })).statusCode).toBe(400);
    expect((await post('/v1/code/read', { ...who, path: 'yok' })).statusCode).toBe(404);
    expect((await post('/v1/code/glob', { ...who, pattern: '*.txt' })).json().files).toEqual(['a.txt']);
    expect((await post('/v1/code/changes', who)).json()).toMatchObject({ additions: 1, deletions: 0 });
    expect((await post('/v1/code/commit', { ...who, message: 'deneme' })).json().sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await post('/v1/code/destroy', who)).statusCode).toBe(204);
    await app.close();
  });
});

describe('push', () => {
  it('son commit\'i uzak depoya iter; ajanın yazdığı .git ayarları/hook\'ları token\'lı süreçte çalışmaz, token çıktıda sızmaz', async () => {
    const { code } = makeCode();
    const remote = join(tmp, 'remote.git');
    rmSync(remote, { recursive: true, force: true });
    execFileSync('git', ['init', '-q', '--bare', remote]);
    await code.prepare(req({ session: 'u1:push' }));
    await code.writeFile('u1', 'u1:push', 'yeni.txt', 'merhaba\n');
    const c = await code.commit('u1', 'u1:push', 'deneme');
    expect(c.sha).toMatch(/^[0-9a-f]{40}$/);

    // ajan .git/config ve hook'lara yazmaya çalışıyor (komut satırından; dosya aracı .git'e izin vermez)
    const marker = join(tmp, 'pwned');
    rmSync(marker, { force: true });
    await code.exec('u1', 'u1:push', `printf '[core]\\n\\tfsmonitor = touch ${marker}\\n\\thooksPath = .git/hooks\\n[credential]\\n\\thelper = !touch ${marker}\\n' >> .git/config; printf '#!/bin/sh\\ntouch ${marker}\\n' > .git/hooks/pre-push; chmod +x .git/hooks/pre-push`);

    const r = await code.push('u1', 'u1:push', 'gho_supersecrettoken', { pushUrl: remote });
    expect(r).toMatchObject({ sha: c.sha, branch: 'sixfinger/alpha-abc123' });
    expect(existsSync(marker)).toBe(false);
    expect(JSON.stringify(r)).not.toContain('gho_supersecrettoken');
    expect(git(remote, 'rev-parse', 'refs/heads/sixfinger/alpha-abc123').trim()).toBe(c.sha);

    // ikinci commit: hızlı ileri sarma
    await code.writeFile('u1', 'u1:push', 'iki.txt', 'x\n');
    const c2 = await code.commit('u1', 'u1:push', 'ikinci');
    await code.push('u1', 'u1:push', 'gho_supersecrettoken', { pushUrl: remote });
    expect(git(remote, 'rev-parse', 'refs/heads/sixfinger/alpha-abc123').trim()).toBe(c2.sha);
  });

  it('pushUrl yalnızca local-unsafe\'te; token zorunlu; hazırlanmamış oturumda 409', async () => {
    const { code } = makeCode();
    await expect(code.push('u1', 'u1:yok', 'tok')).rejects.toMatchObject({ code: 'not_prepared' });
    await code.prepare(req({ session: 'u1:push2' }));
    await expect(code.push('u1', 'u1:push2', '')).rejects.toThrow(/GitHub erişimi/);
  });
});

describe('arşiv', () => {
  it('çalışma alanını node_modules ve .git olmadan tar.gz verir; sembolik bağlantı hedefi sızmaz', async () => {
    const { code } = makeCode();
    await code.prepare(req({ session: 'u1:arc' }));
    await code.writeFile('u1', 'u1:arc', 'src/a.txt', 'merhaba\n');
    await code.exec('u1', 'u1:arc', 'mkdir -p node_modules/x && echo big > node_modules/x/i.js && ln -s /etc/hostname link');
    const tgz = await code.archive('u1', 'u1:arc');
    expect(tgz.subarray(0, 2).toString('hex')).toBe('1f8b');
    const dir = mkdtempSync(join(tmpdir(), 'sf-arc-'));
    writeFileSync(join(dir, 'a.tgz'), tgz);
    const list = execFileSync('tar', ['tzf', join(dir, 'a.tgz')], { encoding: 'utf8' });
    expect(list).toContain('src/a.txt');
    expect(list).toContain('app.js');
    expect(list).not.toContain('node_modules');
    expect(list).not.toMatch(/\.git\//);
    // bağlantı bağlantı olarak arşivlenir (içeriği değil)
    execFileSync('tar', ['xzf', join(dir, 'a.tgz'), '-C', dir]);
    expect(execFileSync('readlink', [join(dir, 'link')], { encoding: 'utf8' }).trim()).toBe('/etc/hostname');
    rmSync(dir, { recursive: true, force: true });
  });

  it('sınırı aşan arşiv reddedilir', async () => {
    const { code } = makeCode({ CODE_ARCHIVE_MAX_MB: '1' });
    await code.prepare(req({ session: 'u1:arc2' }));
    await code.exec('u1', 'u1:arc2', 'head -c 3000000 /dev/urandom > big.bin');
    await expect(code.archive('u1', 'u1:arc2')).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('önizleme: ham dosya, portlar ve dev-server proxy', () => {
  it('raw: ikili dosyayı baytı baytına verir; yok/klasör/büyük hataları', async () => {
    const { code } = makeCode();
    await code.prepare(req({ session: 'u1:raw' }));
    await code.exec('u1', 'u1:raw', "printf '\\x00\\x01\\xff\\xfe' > b.bin && mkdir -p d");
    expect((await code.raw('u1', 'u1:raw', 'b.bin', 1024)).data.toString('hex')).toBe('0001fffe');
    await expect(code.raw('u1', 'u1:raw', 'yok.txt', 1024)).rejects.toMatchObject({ code: 'not_found' });
    await expect(code.raw('u1', 'u1:raw', 'd', 1024)).rejects.toMatchObject({ code: 'is_directory' });
    await expect(code.raw('u1', 'u1:raw', 'app.js', 8)).rejects.toMatchObject({ code: 'too_large' });
    await expect(code.raw('u1', 'u1:raw', '../etc/passwd', 1024)).rejects.toThrow();
  });

  it('ports: dinleyen portları bulur', async () => {
    const { code } = makeCode();
    await code.prepare(req({ session: 'u1:ports' }));
    const srv = createServer((_q, r) => r.end('x'));
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as AddressInfo).port;
    try {
      if (port >= 1024) expect(await code.ports('u1', 'u1:ports')).toContain(port);
    } finally {
      srv.close();
    }
  });

  it('http: dev-server\'a istek yapar; durum, başlıklar, ikili gövde ve POST gövdesi geçer', async () => {
    const { code } = makeCode();
    await code.prepare(req({ session: 'u1:http' }));
    const seen: Array<{ m?: string; url?: string; body: string; ct?: string; cookie?: string }> = [];
    const srv = createServer((q, r) => {
      const chunks: Buffer[] = [];
      q.on('data', (c: Buffer) => chunks.push(c));
      q.on('end', () => {
        seen.push({ m: q.method, url: q.url, body: Buffer.concat(chunks).toString(), ct: q.headers['content-type'], cookie: q.headers.cookie });
        if (q.url === '/bin') return void r.writeHead(200, { 'content-type': 'application/octet-stream', 'x-ozel': 'ok' }).end(Buffer.from([0, 1, 255, 254]));
        if (q.url === '/yonlendir') return void r.writeHead(302, { location: '/bin' }).end();
        r.writeHead(201, { 'content-type': 'text/plain', 'set-cookie': 'a=b' }).end('merhaba');
      });
    });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as AddressInfo).port;
    try {
      const bin = await code.http('u1', 'u1:http', { port, method: 'GET', path: '/bin', headers: { cookie: 'gizli=1' } });
      expect(bin.status).toBe(200);
      expect(bin.body.toString('hex')).toBe('0001fffe');
      expect(bin.headers).toContainEqual(['x-ozel', 'ok']);
      expect(bin.headers.some(([k]) => k === 'content-length' || k === 'transfer-encoding')).toBe(false);
      expect(seen[0]!.cookie).toBeUndefined(); // çerez iletilmez

      const post = await code.http('u1', 'u1:http', { port, method: 'POST', path: '/api?x=1', headers: { 'content-type': 'application/json' }, body: Buffer.from('{"a":1}') });
      expect(post.status).toBe(201);
      expect(post.body.toString()).toBe('merhaba');
      expect(seen[1]).toMatchObject({ m: 'POST', url: '/api?x=1', body: '{"a":1}', ct: 'application/json' });

      const redir = await code.http('u1', 'u1:http', { port, method: 'GET', path: '/yonlendir', headers: {} });
      expect(redir.status).toBe(302);
      expect(redir.headers).toContainEqual(['location', '/bin']);

      const head = await code.http('u1', 'u1:http', { port, method: 'HEAD', path: '/bin', headers: {} });
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
    } finally {
      srv.close();
    }
  });

  it('http: dinleyen yoksa anlaşılır hata; geçersiz port/yol/yöntem reddedilir', async () => {
    const { code } = makeCode();
    await code.prepare(req({ session: 'u1:http2' }));
    const free = createServer();
    await new Promise<void>((res) => free.listen(0, '127.0.0.1', res));
    const port = (free.address() as AddressInfo).port;
    await new Promise((res) => free.close(res));
    await expect(code.http('u1', 'u1:http2', { port, method: 'GET', path: '/', headers: {} })).rejects.toMatchObject({ code: 'not_found' });
    await expect(code.http('u1', 'u1:http2', { port: 80, method: 'GET', path: '/', headers: {} })).rejects.toThrow('Port');
    await expect(code.http('u1', 'u1:http2', { port: 3000, method: 'GET', path: '/a b', headers: {} })).rejects.toThrow('yol');
    await expect(code.http('u1', 'u1:http2', { port: 3000, method: 'CONNECT', path: '/', headers: {} })).rejects.toThrow('yöntem');
  });

  it('parseCurlResponse: 1xx ara yanıtını atlar, bozuk girdide null', () => {
    const ok = parseCurlResponse(Buffer.from('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n<p>x</p>'));
    expect(ok?.status).toBe(200);
    expect(ok?.headers).toEqual([['content-type', 'text/html']]);
    expect(ok?.body.toString()).toBe('<p>x</p>');
    expect(parseCurlResponse(Buffer.from('bozuk'))).toBeNull();
  });

  it('parseListeningPorts: yalnızca LISTEN ve 1024+ portlar', () => {
    const t = ['  sl  local_address rem_address   st', '   0: 0100007F:1F90 00000000:0000 0A 0 0', '   1: 0100007F:0050 00000000:0000 0A 0 0', '   2: 0100007F:1F91 0100007F:C350 01 0 0'].join('\n');
    expect(parseListeningPorts(t)).toEqual([8080]);
  });

  it('HTTP uçları: /v1/code/raw ve /v1/code/http', async () => {
    const { cfg, runtime, code } = makeCode();
    const svc = new SandboxService(cfg, runtime, quiet);
    const app = buildServer(svc, cfg, { logger: false, code });
    const h = { authorization: 'Bearer test-token-test-token-test-token' };
    await code.prepare(req({ session: 'u1:ep' }));
    const raw = await app.inject({ method: 'POST', url: '/v1/code/raw', headers: h, payload: { user: 'u1', session: 'u1:ep', path: 'app.js' } });
    expect(raw.statusCode).toBe(200);
    expect(raw.body).toContain('merhaba');
    const bad = await app.inject({ method: 'POST', url: '/v1/code/http', headers: h, payload: { user: 'u1', session: 'u1:ep', port: 80, method: 'GET', path: '/' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
