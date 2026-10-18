import { describe, expect, it } from 'vitest';
import { isBlockedIp, parseSafeUrl, safeFetch } from '../src/services/tools/net.ts';

describe('SSRF koruması', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.10', '64:ff9b::7f00:1', '2002:7f00:1::', 'not-an-ip',
  ])('%s engellenir', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '172.32.0.1', '::ffff:8.8.8.8'])('%s serbest', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each([
    'ftp://example.com/a',
    'file:///etc/passwd',
    'http://localhost/',
    'http://localhost:5432/',
    'http://127.0.0.1:8787/api/health',
    'http://[::1]/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://user:pass@example.com/',
    'http://example.com:22/',
    'http://intranet/',
    'http://nas.local/',
    'http://db.internal/',
    'http://2130706433/', // 127.0.0.1 ondalık biçimi
    'http://0x7f000001/',
    'not a url',
  ])('%s reddedilir', (u) => {
    expect(() => parseSafeUrl(u)).toThrow();
  });

  it('normal adresleri kabul eder', () => {
    expect(parseSafeUrl('https://example.com/a?b=1').hostname).toBe('example.com');
    expect(parseSafeUrl('http://example.com:8080/').port).toBe('8080');
  });

  it('safeFetch iç adresi hiç bağlanmadan reddeder', async () => {
    await expect(safeFetch('http://127.0.0.1:1/')).rejects.toThrow(/engellendi/);
    await expect(safeFetch('http://localhost/')).rejects.toThrow(/engellendi/);
  });

  it('DNS ile iç adrese çözülen alan adlarını bağlantı anında engeller', async () => {
    // localtest.me → 127.0.0.1 (herkese açık joker DNS). Ağ yoksa ENOTFOUND de kabul edilir.
    await expect(safeFetch('http://localtest.me:8080/', { timeoutMs: 5_000 })).rejects.toThrow(/engellendi|bulunamadı|bağlanılamadı|zamanında/);
  });
});
