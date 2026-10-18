import { afterEach, describe, expect, it } from 'vitest';
import { SandboxBusyError, SandboxError } from '../src/runtime/types.ts';
import { sessionId, workPath } from '../src/service.ts';
import { makeService } from './helpers.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
function svc(over: Record<string, string> = {}, now?: () => number) {
  const s = makeService(over, now);
  cleanups.push(s.cleanup);
  return s;
}

describe('workPath', () => {
  it.each([
    ['app.py', 'app.py'],
    ['./src/app.py', 'src/app.py'],
    ['/work/a/b.txt', 'a/b.txt'],
    ['/work', '.'],
    ['a/../b.txt', 'b.txt'],
    ['-rf', './-rf'],
  ])('%s → %s', (input, expected) => expect(workPath(input)).toBe(expected));

  it.each(['', '  ', '../x', 'a/../../x', '/etc/passwd', '/work/../etc/passwd', '/workspace/x', 'a\0b', 'x'.repeat(500)])('%j reddedilir', (input) => {
    expect(() => workPath(input)).toThrow(SandboxError);
  });
});

describe('sessionId', () => {
  it('sabit uzunlukta ve güvenli karakterlerle', () => {
    expect(sessionId('u1:c1')).toMatch(/^s[0-9a-f]{24}$/);
    expect(sessionId('x; rm -rf /')).toMatch(/^s[0-9a-f]{24}$/);
    expect(sessionId('a')).not.toBe(sessionId('b'));
  });
});

describe('exec', () => {
  it('çıktıyı ve çıkış kodunu döndürür; çalışma klasörü oturuma özeldir', async () => {
    const { service } = svc();
    const a = await service.exec('u1', 'chat-1', 'echo merhaba && echo hata >&2; exit 3');
    expect(a).toMatchObject({ exitCode: 3, stdout: 'merhaba\n', stderr: 'hata\n', timedOut: false, truncated: false });
    await service.exec('u1', 'chat-1', 'echo icerik > not.txt');
    expect((await service.exec('u1', 'chat-1', 'cat not.txt')).stdout).toBe('icerik\n');
    expect((await service.exec('u1', 'chat-2', 'cat not.txt')).exitCode).not.toBe(0); // başka sohbet görmez
  });

  it('zaman aşımında süreci öldürür', async () => {
    const { service } = svc();
    const t = Date.now();
    const r = await service.exec('u1', 's', 'sleep 30', 1);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t).toBeLessThan(6_000);
  });

  it('çıktıyı sınırlar ve sonsuz çıktıyı erken keser', async () => {
    const { service } = svc({ OUTPUT_MAX_BYTES: '2048' });
    const r = await service.exec('u1', 's', 'yes aaaaaaaaaaaaaaaaaaaaaaaa', 20);
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(2048);
    expect(r.durationMs).toBeLessThan(5_000);
  });

  it('istenen süreyi üst sınıra çeker', async () => {
    const { service } = svc({ EXEC_MAX_SECONDS: '2' });
    const r = await service.exec('u1', 's', 'sleep 20', 600);
    expect(r.timedOut).toBe(true);
  });
});

describe('dosya işlemleri', () => {
  it('yaz → oku → düzenle', async () => {
    const { service } = svc();
    await service.writeFile('u1', 'c', 'src/app.py', 'print("a")\nprint("b")\nprint("a")\n');
    expect((await service.readFile('u1', 'c', '/work/src/app.py')).content).toContain('print("b")');

    const e = await service.editFile('u1', 'c', 'src/app.py', 'print("b")', 'print("B!")');
    expect(e.replacements).toBe(1);
    expect(e.snippet).toContain('print("B!")');
    expect((await service.readFile('u1', 'c', 'src/app.py')).content).toBe('print("a")\nprint("B!")\nprint("a")\n');
  });

  it('düzenleme: bulunamadı / birden çok eşleşme / replace_all', async () => {
    const { service } = svc();
    await service.writeFile('u1', 'c', 'f.txt', 'x\nx\ny\n');
    await expect(service.editFile('u1', 'c', 'f.txt', 'zzz', 'q')).rejects.toThrow(/bulunamadı/);
    await expect(service.editFile('u1', 'c', 'f.txt', 'x', 'q')).rejects.toThrow(/2 kez/);
    expect((await service.editFile('u1', 'c', 'f.txt', 'x', 'q', true)).replacements).toBe(2);
    expect((await service.readFile('u1', 'c', 'f.txt')).content).toBe('q\nq\ny\n');
    await expect(service.editFile('u1', 'c', 'f.txt', 'y', 'y')).rejects.toThrow(/aynı/);
    await expect(service.editFile('u1', 'c', 'f.txt', '', 'y')).rejects.toThrow(/boş/);
  });

  it('yol kaçışı, olmayan dosya, klasör, ikili dosya, büyük dosya', async () => {
    const { service } = svc({ FILE_MAX_BYTES: '2048' });
    await expect(service.writeFile('u1', 'c', '../evil.txt', 'x')).rejects.toThrow(/dışına/);
    await expect(service.readFile('u1', 'c', '/etc/passwd')).rejects.toThrow(/\/work/);
    await expect(service.readFile('u1', 'c', 'yok.txt')).rejects.toMatchObject({ code: 'not_found' });
    await service.exec('u1', 'c', 'mkdir d && printf "\\0\\1\\2" > bin.dat');
    await expect(service.readFile('u1', 'c', 'd')).rejects.toThrow(/klasör/);
    await expect(service.readFile('u1', 'c', 'bin.dat')).rejects.toThrow(/ikili/);
    await expect(service.writeFile('u1', 'c', 'big.txt', 'a'.repeat(3000))).rejects.toMatchObject({ code: 'too_large' });
    await service.exec('u1', 'c', 'head -c 5000 /dev/zero | tr "\\0" "a" > big2.txt');
    expect((await service.readFile('u1', 'c', 'big2.txt')).truncated).toBe(true);
  });

  it('dosya listesi', async () => {
    const { service } = svc();
    await service.writeFile('u1', 'c', 'a.txt', 'aaa');
    await service.writeFile('u1', 'c', 'x/b.txt', 'bb');
    await service.exec('u1', 'c', 'echo gizli > .hidden');
    const files = await service.listFiles('u1', 'c');
    expect(files).toEqual(expect.arrayContaining([{ path: 'a.txt', bytes: 3 }, { path: 'x/b.txt', bytes: 2 }]));
    expect(files.some((f) => f.path.startsWith('.'))).toBe(false);
  });

  it('dosya adı kabuk enjeksiyonu yapamaz', async () => {
    const { service } = svc();
    await service.writeFile('u1', 'c', 'a; touch pwned.txt', 'x');
    const r = await service.exec('u1', 'c', 'ls');
    expect(r.stdout.trim().split('\n')).toEqual(['a; touch pwned.txt']); // ayrı bir pwned.txt dosyası oluşmadı
  });
});

describe('kabul kontrolü', () => {
  it('aynı kullanıcının işlemleri sırayla çalışır', async () => {
    const { service } = svc();
    const order: string[] = [];
    const a = service.exec('u1', 's', 'sleep 0.4; echo a').then(() => order.push('a'));
    const b = service.exec('u1', 's', 'echo b').then(() => order.push('b'));
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('farklı kullanıcılar eşzamanlı çalışır, sınır dolunca kuyruğa girer, kuyruk dolunca 503', async () => {
    const { service } = svc({ MAX_CONCURRENT_EXEC: '2', MAX_QUEUE: '1' });
    const slow = (u: string) => service.exec(u, `s-${u}`, 'sleep 0.6');
    const p = [slow('a'), slow('b')]; // 2 slot dolu
    await new Promise((r) => setTimeout(r, 100));
    const queued = slow('c'); // kuyrukta
    await new Promise((r) => setTimeout(r, 50));
    await expect(slow('d')).rejects.toBeInstanceOf(SandboxBusyError); // kuyruk dolu
    expect(service.stats()).toMatchObject({ execActive: 2, queued: 1 });
    await Promise.all([...p, queued]);
    expect(service.stats()).toMatchObject({ execActive: 0, queued: 0 });
  });

  it('konteyner sınırı: en eski boştaki kapatılıp yer açılır; hepsi meşgulse 503', async () => {
    const { service } = svc({ MAX_CONTAINERS: '2' });
    await service.exec('a', 'sa', 'true');
    await service.exec('b', 'sb', 'true');
    await service.exec('c', 'sc', 'true'); // sa çıkarılır
    expect(service.stats().containers).toBe(2);

    const { service: s2 } = svc({ MAX_CONTAINERS: '1', MAX_CONCURRENT_EXEC: '4' });
    const busy = s2.exec('a', 'sa', 'sleep 0.5');
    await new Promise((r) => setTimeout(r, 100));
    await expect(s2.exec('b', 'sb', 'true')).rejects.toBeInstanceOf(SandboxBusyError);
    await busy;
  });

  it('boşta kalanları kapatır, meşgul olanlara dokunmaz', async () => {
    let t = 1_000_000;
    const { service } = svc({ IDLE_SECONDS: '10' }, () => t);
    await service.exec('a', 'sa', 'true');
    t += 5_000;
    await service.exec('b', 'sb', 'true');
    t += 8_000; // sa: 13sn boşta, sb: 8sn
    expect(await service.reapIdle(t)).toBe(1);
    expect(service.stats().containers).toBe(1);
  });
});
