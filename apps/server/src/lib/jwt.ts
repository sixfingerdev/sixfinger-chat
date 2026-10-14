import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../config.ts';

export interface AccessClaims {
  sub: string;
  /** Oturum (refresh_tokens.id) */
  sid: string;
}

export function createJwt(config: Config) {
  const key = new TextEncoder().encode(config.JWT_SECRET);
  return {
    async sign(claims: AccessClaims): Promise<string> {
      return new SignJWT({ sid: claims.sid })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuer('sixfinger')
        .setIssuedAt()
        .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },
    async verify(token: string): Promise<AccessClaims | null> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: 'sixfinger', algorithms: ['HS256'] });
        if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
        return { sub: payload.sub, sid: payload.sid };
      } catch {
        return null;
      }
    },
  };
}
export type Jwt = ReturnType<typeof createJwt>;
