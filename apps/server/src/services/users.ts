import { TIER_LIMITS, type Tier, type UserDTO, type UserSettings } from '@sixfinger/shared';
import type { Queryable } from '../db/pool.ts';

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  is_guest: boolean;
  email_verified_at: Date | null;
  locale: 'tr' | 'en';
  created_at: Date;
  custom_name: string | null;
  about: string | null;
  instructions: string | null;
  default_persona: string | null;
  memory_enabled: boolean | null;
}

export function tierOf(u: Pick<UserRow, 'is_guest' | 'email_verified_at'>): Tier {
  if (u.is_guest) return 'guest';
  return u.email_verified_at ? 'member' : 'unverified';
}

export const limitsFor = (tier: Tier) => TIER_LIMITS[tier];

const SELECT_USER = `
  select u.id, u.email, u.password_hash, u.display_name, u.is_guest, u.email_verified_at, u.locale, u.created_at,
         s.custom_name, s.about, s.instructions, s.default_persona, s.memory_enabled
  from users u left join user_settings s on s.user_id = u.id`;

export async function findUserById(db: Queryable, id: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>(`${SELECT_USER} where u.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>(`${SELECT_USER} where lower(u.email) = lower($1)`, [email]);
  return r.rows[0] ?? null;
}

export function settingsOf(u: UserRow): UserSettings {
  return {
    customName: u.custom_name ?? '',
    about: u.about ?? '',
    instructions: u.instructions ?? '',
    defaultPersona: u.default_persona ?? 'default',
    memoryEnabled: u.memory_enabled ?? true,
  };
}

export function toUserDTO(u: UserRow): UserDTO {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    isGuest: u.is_guest,
    emailVerified: Boolean(u.email_verified_at),
    locale: u.locale,
    tier: tierOf(u),
    settings: settingsOf(u),
    createdAt: u.created_at.toISOString(),
  };
}
