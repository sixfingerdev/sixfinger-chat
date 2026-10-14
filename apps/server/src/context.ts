import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/pool.ts';
import type { Jwt } from './lib/jwt.ts';
import type { Mailer } from './lib/mailer.ts';
import type { Sessions } from './services/sessions.ts';
import type { Codes } from './services/codes.ts';
import type { Usage } from './services/usage.ts';
import type { AiProvider } from './services/ai.ts';

export interface AppContext {
  config: Config;
  db: Db;
  log: FastifyBaseLogger;
  jwt: Jwt;
  mailer: Mailer;
  sessions: Sessions;
  codes: Codes;
  usage: Usage;
  ai: AiProvider;
}
