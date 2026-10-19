import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sır saklama (GitHub token'ı, ortam değişkenleri) ve imzalı kısa ömürlü durum (OAuth `state`).
 * Anahtar `CODE_SECRET_KEY`'den türetilir; alt anahtarlar amaca göre ayrıdır.
 */
export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string | null;
  signState(payload: Record<string, unknown>, ttlSeconds: number): string;
  verifyState<T extends Record<string, unknown>>(token: string): T | null;
}

const derive = (secret: string, info: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, 'sixfinger-code', info, 32));

export function createSecretBox(secret: string): SecretBox {
  const encKey = derive(secret, 'secretbox-v1');
  const macKey = derive(secret, 'state-v1');

  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    open(sealed) {
      const [v, iv, tag, ct] = sealed.split('.');
      if (v !== 'v1' || !iv || !tag || ct === undefined) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
        d.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
    signState(payload, ttlSeconds) {
      const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
      const mac = createHmac('sha256', macKey).update(body).digest('base64url');
      return `${body}.${mac}`;
    },
    verifyState<T extends Record<string, unknown>>(token: string): T | null {
      const [body, mac] = token.split('.');
      if (!body || !mac) return null;
      const expected = createHmac('sha256', macKey).update(body).digest();
      const given = Buffer.from(mac, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
        if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
        return p;
      } catch {
        return null;
      }
    },
  };
}
