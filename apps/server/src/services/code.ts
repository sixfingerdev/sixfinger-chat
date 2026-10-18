import { randomBytes } from 'node:crypto';
import {
  CODE_DISK_DEFAULT_MB,
  CODE_MAX_ENVIRONMENTS,
  CODE_MAX_SESSIONS,
  type CodeCreditsDTO,
  type CodeEnvironmentDTO,
  type CodeNetwork,
  type CodeSessionDTO,
  type GithubAccountDTO,
} from '@sixfinger/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/pool.ts';
import { withTx } from '../db/pool.ts';
import { conflict, HttpError, notFound } from '../lib/errors.ts';
import type { SecretBox } from '../lib/secretbox.ts';

interface EnvRow {
  id: string;
  name: string;
  network: CodeNetwork;
  allowed_domains: string[];
  env_vars_enc: string;
  setup_script: string;
  disk_mb: number;
  created_at: Date;
  updated_at: Date;
}

interface SessionRow {
  chat_id: string;
  title: string;
  repo: string;
  base_branch: string;
  work_branch: string;
  environment_id: string | null;
  environment_name: string | null;
  status: CodeSessionDTO['status'];
  disk_used_mb: number;
  preview: string | null;
  created_at: Date;
  last_message_at: Date | null;
}

export interface EnvInput {
  name?: string;
  network?: CodeNetwork;
  allowedDomains?: string[];
  setupScript?: string;
  diskMb?: number;
  envVars?: Record<string, string>;
}

const SESSION_SELECT = `
  select s.chat_id, c.title, s.repo, s.base_branch, s.work_branch, s.environment_id, e.name as environment_name,
         s.status, s.disk_used_mb, s.created_at, c.last_message_at,
         (select left(regexp_replace(m.content, '\\s+', ' ', 'g'), 160) from messages m
           where m.chat_id = s.chat_id and m.role = 'assistant' and m.content <> '' order by m.seq desc limit 1) as preview
    from code_sessions s
    join chats c on c.id = s.chat_id
    left join code_environments e on e.id = s.environment_id`;

const toSessionDTO = (r: SessionRow): CodeSessionDTO => ({
  chatId: r.chat_id,
  title: r.title,
  repo: r.repo,
  baseBranch: r.base_branch,
  workBranch: r.work_branch,
  environmentId: r.environment_id,
  environmentName: r.environment_name,
  status: r.status,
  diskUsedMb: r.disk_used_mb,
  preview: r.preview ?? '',
  createdAt: r.created_at.toISOString(),
  lastMessageAt: r.last_message_at?.toISOString() ?? null,
});

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

/** Code: GitHub bağlantısı, ortamlar, oturumlar ve günlük kredi. */
export function createCode(db: Db, config: Config, box: SecretBox | null) {
  const enabled = Boolean(box && config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
  const needBox = (): SecretBox => {
    if (!box) throw new HttpError(503, 'upstream_unavailable', 'Code bu sunucuda ayarlanmamış.');
    return box;
  };

  const isAllowed = (user: { email: string | null; emailVerified: boolean }): boolean => {
    if (!enabled || !user.email || !user.emailVerified) return false;
    return config.codeAllowed.all || config.codeAllowed.emails.has(user.email.toLowerCase());
  };

  // ---- GitHub bağlantısı ----
  async function getConnection(userId: string): Promise<(GithubAccountDTO & { token: string }) | null> {
    const r = await db.query<{ login: string; avatar_url: string; token_enc: string }>(
      'select login, avatar_url, token_enc from github_connections where user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const token = needBox().open(row.token_enc);
    if (!token) return null;
    return { login: row.login, avatarUrl: row.avatar_url, token };
  }

  async function saveConnection(
    userId: string,
    g: { id: number; login: string; avatarUrl: string },
    token: string,
    scope: string,
  ): Promise<void> {
    await db.query(
      `insert into github_connections (user_id, github_id, login, avatar_url, token_enc, scope)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update set github_id = excluded.github_id, login = excluded.login,
         avatar_url = excluded.avatar_url, token_enc = excluded.token_enc, scope = excluded.scope, created_at = now()`,
      [userId, g.id, g.login, g.avatarUrl, needBox().seal(token), scope],
    );
  }

  async function removeConnection(userId: string): Promise<string | null> {
    const conn = await getConnection(userId).catch(() => null);
    await db.query('delete from github_connections where user_id = $1', [userId]);
    return conn?.token ?? null;
  }

  // ---- Ortamlar ----
  const toEnvDTO = (r: EnvRow, withVars: boolean): CodeEnvironmentDTO => {
    const vars = r.env_vars_enc ? (JSON.parse(needBox().open(r.env_vars_enc) ?? '{}') as Record<string, string>) : {};
    return {
      id: r.id,
      name: r.name,
      network: r.network,
      allowedDomains: r.allowed_domains,
      setupScript: r.setup_script,
      diskMb: r.disk_mb,
      envVarCount: Object.keys(vars).length,
      ...(withVars ? { envVars: vars } : {}),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  };

  async function listEnvironments(userId: string): Promise<CodeEnvironmentDTO[]> {
    let r = await db.query<EnvRow>('select * from code_environments where user_id = $1 order by created_at', [userId]);
    if (!r.rowCount) {
      // İlk kullanımda hazır bir "Default" ortamı.
      await db.query(
        `insert into code_environments (user_id, name, network, disk_mb) values ($1, 'Default', 'trusted', $2)
         on conflict do nothing`,
        [userId, CODE_DISK_DEFAULT_MB],
      );
      r = await db.query<EnvRow>('select * from code_environments where user_id = $1 order by created_at', [userId]);
    }
    return r.rows.map((e) => toEnvDTO(e, false));
  }

  async function getEnvironment(userId: string, id: string): Promise<CodeEnvironmentDTO> {
    const r = await db.query<EnvRow>('select * from code_environments where id = $1 and user_id = $2', [id, userId]);
    if (!r.rows[0]) throw notFound('Ortam bulunamadı.');
    return toEnvDTO(r.rows[0], true);
  }

  const uniqueName = (err: unknown): never => {
    if ((err as { code?: string }).code === '23505') throw conflict('Bu isimde bir ortamın var.');
    throw err;
  };

  async function createEnvironment(userId: string, input: EnvInput): Promise<CodeEnvironmentDTO> {
    const n = await db.query<{ n: number }>('select count(*)::int as n from code_environments where user_id = $1', [userId]);
    if ((n.rows[0]?.n ?? 0) >= CODE_MAX_ENVIRONMENTS) {
      throw new HttpError(403, 'tier_restricted', `En fazla ${CODE_MAX_ENVIRONMENTS} ortam oluşturabilirsin.`);
    }
    const enc = input.envVars && Object.keys(input.envVars).length ? needBox().seal(JSON.stringify(input.envVars)) : '';
    try {
      const r = await db.query<EnvRow>(
        `insert into code_environments (user_id, name, network, allowed_domains, env_vars_enc, setup_script, disk_mb)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [
          userId,
          input.name ?? 'Ortam',
          input.network ?? 'trusted',
          input.allowedDomains ?? [],
          enc,
          input.setupScript ?? '',
          input.diskMb ?? CODE_DISK_DEFAULT_MB,
        ],
      );
      return toEnvDTO(r.rows[0]!, true);
    } catch (err) {
      return uniqueName(err);
    }
  }

  async function updateEnvironment(userId: string, id: string, input: EnvInput): Promise<CodeEnvironmentDTO> {
    const enc = input.envVars === undefined ? null : Object.keys(input.envVars).length ? needBox().seal(JSON.stringify(input.envVars)) : '';
    try {
      const r = await db.query<EnvRow>(
        `update code_environments set
            name = coalesce($3, name),
            network = coalesce($4, network),
            allowed_domains = coalesce($5, allowed_domains),
            env_vars_enc = coalesce($6, env_vars_enc),
            setup_script = coalesce($7, setup_script),
            disk_mb = coalesce($8, disk_mb),
            updated_at = now()
          where id = $1 and user_id = $2 returning *`,
        [id, userId, input.name ?? null, input.network ?? null, input.allowedDomains ?? null, enc, input.setupScript ?? null, input.diskMb ?? null],
      );
      if (!r.rows[0]) throw notFound('Ortam bulunamadı.');
      return toEnvDTO(r.rows[0], true);
    } catch (err) {
      return uniqueName(err);
    }
  }

  async function deleteEnvironment(userId: string, id: string): Promise<boolean> {
    const r = await db.query('delete from code_environments where id = $1 and user_id = $2', [id, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---- Oturumlar ----
  async function listSessions(userId: string): Promise<CodeSessionDTO[]> {
    const r = await db.query<SessionRow>(
      `${SESSION_SELECT} where s.user_id = $1 order by coalesce(c.last_message_at, s.created_at) desc limit 100`,
      [userId],
    );
    return r.rows.map(toSessionDTO);
  }

  async function getSession(userId: string, chatId: string): Promise<CodeSessionDTO | null> {
    const r = await db.query<SessionRow>(`${SESSION_SELECT} where s.chat_id = $1 and s.user_id = $2`, [chatId, userId]);
    return r.rows[0] ? toSessionDTO(r.rows[0]) : null;
  }

  async function createSession(
    userId: string,
    input: { repo: string; baseBranch: string; environmentId?: string },
  ): Promise<CodeSessionDTO> {
    const n = await db.query<{ n: number }>('select count(*)::int as n from code_sessions where user_id = $1', [userId]);
    if ((n.rows[0]?.n ?? 0) >= CODE_MAX_SESSIONS) {
      throw new HttpError(403, 'tier_restricted', `En fazla ${CODE_MAX_SESSIONS} Code oturumu saklanır. Eskilerini sil.`);
    }
    let environmentId = input.environmentId ?? null;
    if (environmentId) {
      const e = await db.query('select 1 from code_environments where id = $1 and user_id = $2', [environmentId, userId]);
      if (!e.rowCount) throw notFound('Ortam bulunamadı.');
    } else {
      environmentId = (await listEnvironments(userId))[0]?.id ?? null;
    }
    const repoName = input.repo.split('/')[1] ?? 'oturum';
    const workBranch = `sixfinger/${slugify(repoName) || 'oturum'}-${randomBytes(3).toString('hex')}`;
    const chatId = await withTx(db, async (c) => {
      const chat = await c.query<{ id: string }>(
        `insert into chats (user_id, title, kind, title_generated) values ($1, $2, 'code', false) returning id`,
        [userId, 'Yeni oturum'],
      );
      const id = chat.rows[0]!.id;
      await c.query(
        `insert into code_sessions (chat_id, user_id, repo, base_branch, work_branch, environment_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, userId, input.repo, input.baseBranch, workBranch, environmentId],
      );
      return id;
    });
    return (await getSession(userId, chatId))!;
  }

  async function deleteSession(userId: string, chatId: string): Promise<boolean> {
    // Sohbeti silmek code_sessions satırını da düşürür (cascade).
    const r = await db.query(`delete from chats where id = $1 and user_id = $2 and kind = 'code'`, [chatId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---- Kredi ----
  async function credits(userId: string): Promise<CodeCreditsDTO> {
    const r = await db.query<{ credits: string; resets_at: Date }>(
      `select coalesce((select credits from code_credit_daily where user_id = $1 and day = (now() at time zone 'Europe/Istanbul')::date), 0) as credits,
              (((now() at time zone 'Europe/Istanbul')::date + 1)::timestamp at time zone 'Europe/Istanbul') as resets_at`,
      [userId],
    );
    const row = r.rows[0]!;
    return {
      used: Math.round(Number(row.credits) * 100) / 100,
      limit: config.CODE_DAILY_CREDITS,
      resetsAt: row.resets_at.toISOString(),
    };
  }

  /** Kredi harcar. Limit zaten aşıldıysa 429 fırlatır (harcama yapılmışsa limit biraz aşılabilir, bir sonraki istek durur). */
  async function spend(userId: string, amount: number): Promise<CodeCreditsDTO> {
    const before = await credits(userId);
    if (before.used >= before.limit) {
      throw new HttpError(429, 'quota_exceeded', 'Günlük Code kredin doldu. Yarın yenilenecek.', {
        resetsAt: before.resetsAt,
        limit: before.limit,
      });
    }
    await db.query(
      `insert into code_credit_daily (user_id, day, credits) values ($1, (now() at time zone 'Europe/Istanbul')::date, $2)
       on conflict (user_id, day) do update set credits = code_credit_daily.credits + $2`,
      [userId, amount],
    );
    return credits(userId);
  }

  return {
    enabled,
    isAllowed,
    getConnection,
    saveConnection,
    removeConnection,
    listEnvironments,
    getEnvironment,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    listSessions,
    getSession,
    createSession,
    deleteSession,
    credits,
    spend,
  };
}
export type Code = ReturnType<typeof createCode>;
