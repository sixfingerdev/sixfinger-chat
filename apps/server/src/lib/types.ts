import type { Tier, TierLimits } from '@sixfinger/shared';

export interface AuthUser {
  id: string;
  email: string | null;
  isGuest: boolean;
  emailVerified: boolean;
  tier: Tier;
  limits: TierLimits;
  locale: 'tr' | 'en';
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}
