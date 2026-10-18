import { describe, expect, it } from 'vitest';
import { buildExecArgs, buildRunArgs } from '../src/runtime/docker.ts';
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
