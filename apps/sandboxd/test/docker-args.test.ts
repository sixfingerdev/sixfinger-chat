import { describe, expect, it } from 'vitest';
import { buildCodeRunArgs, buildExecArgs, buildHelperArgs, buildRunArgs } from '../src/runtime/docker.ts';
import type { CodeProfile } from '../src/runtime/types.ts';
import { makeConfig } from './helpers.ts';

const has = (args: string[], ...seq: string[]) => args.some((_, i) => seq.every((s, j) => args[i + j] === s));

describe('docker run bayrakları', () => {
  const cfg = makeConfig();
  const args = buildRunArgs(cfg, 'sf-abc', 'none');

  it('ayrıcalıkları kısar', () => {
    expect(has(args, '--cap-drop', 'ALL')).toBe(true);
    expect(has(args, '--security-opt', 'no-new-privileges')).toBe(true);
    expect(args).toContain('--read-only');
    expect(has(args, '--user', '1000:1000')).toBe(true);
    expect(args).not.toContain('--privileged');
    expect(args.join(' ')).not.toMatch(/docker\.sock|--pid=host|--network=host|--network host|-v |--volume/);
  });

  it('kaynakları sınırlar ve diske yazmaz', () => {
    expect(has(args, '--memory', '320m')).toBe(true);
    expect(has(args, '--memory-swap', '320m')).toBe(true);
    expect(has(args, '--pids-limit', '64')).toBe(true);
    expect(has(args, '--cpus', '0.5')).toBe(true);
    expect(args.some((a) => a.startsWith('/work:rw,') || a.startsWith('/work:rw'))).toBe(true);
    expect(args.find((a) => a.startsWith('/work'))).toContain('size=64m');
    expect(args.find((a) => a.startsWith('/tmp'))).toContain('size=32m');
    expect(has(args, '--log-driver', 'none')).toBe(true);
  });

  it('ağ kapalıysa --network none, DNS yok', () => {
    expect(has(args, '--network', 'none')).toBe(true);
    expect(args).not.toContain('--dns');
  });

  it('kısıtlı ağda özel ağa bağlanır ve genel DNS kullanır', () => {
    const r = buildRunArgs(cfg, 'sf-abc', 'restricted');
    expect(has(r, '--network', 'sixfinger-sandbox')).toBe(true);
    expect(has(r, '--dns', '1.1.1.1')).toBe(true);
    expect(has(r, '--dns', '9.9.9.9')).toBe(true);
    expect(has(r, '--network', 'none')).toBe(false);
  });

  it('imaj ve ana süreç en sonda, kabuk enjeksiyonu yok', () => {
    expect(args.slice(-3)).toEqual(['sixfinger-sandbox:latest', 'sleep', 'infinity']);
  });

  it('exec: zaman aşımı konteyner içinde `timeout` ile uygulanır', () => {
    const e = buildExecArgs('sf-abc', ['bash', '-lc', 'echo $(whoami); rm -rf /'], 30_000);
    expect(e.slice(0, 7)).toEqual(['exec', '-i', '-u', '1000:1000', '-w', '/work', 'sf-abc']);
    expect(e.slice(7, 11)).toEqual(['timeout', '-k', '2', '30']);
    // komut tek bir argüman olarak geçer (ana makinede kabuk yorumlamaz)
    expect(e.at(-1)).toBe('echo $(whoami); rm -rf /');
  });
});


describe('Code konteyneri bayrakları', () => {
  const cfg = makeConfig();
  const profile = (over: Partial<CodeProfile> = {}): CodeProfile => ({
    kind: 'code',
    dir: '/var/lib/sixfinger-code/workspaces/cabc',
    hostDir: '/mnt/hdd/code/workspaces/cabc',
    memMb: 1024,
    cpus: 1,
    pids: 256,
    tmpMb: 256,
    fsizeBytes: 512 * 1024 * 1024,
    network: 'proxy',
    networkName: 'sixfinger-code',
    proxyUrl: 'http://cabc:gizli-parola@sandboxd:3128',
    env: { API_KEY: 'cok-gizli-deger', NODE_ENV: 'development' },
    ...over,
  });
  const { args, env } = buildCodeRunArgs(cfg, 'sf-cabc', profile());

  it('ayrıcalıkları kısar; docker soketi/ayrıcalıklı mod/ana makine ağı yok', () => {
    expect(has(args, '--cap-drop', 'ALL')).toBe(true);
    expect(has(args, '--security-opt', 'no-new-privileges')).toBe(true);
    expect(args).toContain('--read-only');
    expect(has(args, '--user', '1000:1000')).toBe(true);
    const joined = args.join(' ');
    expect(joined).not.toMatch(/docker\.sock|--privileged|--pid=host|--network=host|--network host|--volume| -v /);
  });

  it('yalnızca kendi çalışma alanını bind-mount eder', () => {
    const mounts = args.filter((a) => a.startsWith('type=bind'));
    expect(mounts).toEqual(['type=bind,src=/mnt/hdd/code/workspaces/cabc,dst=/work']);
    // /work için tmpfs YOK (disk kalıcıdır); /tmp RAM'de
    expect(args.some((a) => a.startsWith('/work:'))).toBe(false);
    expect(args.find((a) => a.startsWith('/tmp:'))).toContain('size=256m');
  });

  it('kaynakları sınırlar, tek dosya boyutunu kotaya bağlar', () => {
    expect(has(args, '--memory', '1024m')).toBe(true);
    expect(has(args, '--memory-swap', '1024m')).toBe(true);
    expect(has(args, '--cpus', '1')).toBe(true);
    expect(has(args, '--pids-limit', '256')).toBe(true);
    expect(has(args, '--ulimit', `fsize=${512 * 1024 * 1024}`)).toBe(true);
  });

  it('ağ: yalnızca iç ağ; proxy adresi ve kullanıcı değişken DEĞERLERİ komut satırında YOK', () => {
    expect(has(args, '--network', 'sixfinger-code')).toBe(true);
    expect(args).not.toContain('--dns');
    const joined = args.join(' ');
    expect(joined).not.toContain('gizli-parola');
    expect(joined).not.toContain('cok-gizli-deger');
    // değerler süreç ortamından taşınır
    expect(env.API_KEY).toBe('cok-gizli-deger');
    expect(env.HTTPS_PROXY).toBe('http://cabc:gizli-parola@sandboxd:3128');
    expect(has(args, '--env', 'API_KEY')).toBe(true);
    expect(has(args, '--env', 'HTTPS_PROXY')).toBe(true);
    // önbellekler RAM'e
    expect(has(args, '--env', 'npm_config_cache=/tmp/.npm')).toBe(true);
  });

  it('ağ kapalı ortamda --network none ve proxy değişkeni yok', () => {
    const r = buildCodeRunArgs(cfg, 'sf-cabc', profile({ network: 'none', networkName: undefined, proxyUrl: undefined }));
    expect(has(r.args, '--network', 'none')).toBe(true);
    expect(r.args).not.toContain('HTTPS_PROXY');
    expect(r.env.HTTPS_PROXY).toBeUndefined();
  });

  it('yardımcı konteyner: token yalnızca ortam değişkeni adıyla geçer, iş bitince silinir', () => {
    const a = buildHelperArgs(cfg, profile(), ['GH_TOKEN'], ['git', 'clone', 'https://github.com/o/r.git', '.']);
    expect(a).toContain('--rm');
    expect(has(a, '--env', 'GH_TOKEN')).toBe(true);
    expect(a.join(' ')).not.toMatch(/gho_|ghp_|x-access-token:/);
    expect(has(a, '--cap-drop', 'ALL')).toBe(true);
    expect(has(a, '--entrypoint', 'git')).toBe(true);
    expect(a.filter((x) => x.startsWith('type=bind'))).toHaveLength(1);
    expect(a.join(' ')).not.toContain('gizli-parola'); // proxy kimliği de ortamdan
  });
});
