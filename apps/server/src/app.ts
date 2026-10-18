import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { ErrorCode } from '@sixfinger/shared';
import { loadConfig, type Config } from './config.ts';
import { createPool, type Db } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import type { AppContext } from './context.ts';
import { createGuard } from './guard.ts';
import { HttpError } from './lib/errors.ts';
import { createJwt } from './lib/jwt.ts';
import { createMailer, type Mailer } from './lib/mailer.ts';
import { authRoutes } from './routes/auth.ts';
import { chatRoutes } from './routes/chats.ts';
import { messageRoutes } from './routes/messages.ts';
import { meRoutes } from './routes/me.ts';
import { publicRoutes } from './routes/public.ts';
import { createAi, type AiProvider } from './services/ai.ts';
import { createRunHub } from './services/runs.ts';
import { createSandboxClient, createTools, type Tools } from './services/tools/index.ts';
import { createCodes } from './services/codes.ts';
import { createSessions } from './services/sessions.ts';
import { createUsage } from './services/usage.ts';

export interface BuildOptions {
  config?: Config;
  db?: Db;
  ai?: AiProvider;
  tools?: Tools;
  mailer?: Mailer;
  /** Başlangıçta migrasyonları çalıştır. */
  migrate?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const config = opts.config ?? loadConfig();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576 * 2,
    genReqId: () => crypto.randomUUID(),
  });

  const db = opts.db ?? createPool(config);
  if (opts.migrate ?? true) await migrate(db, (m) => app.log.info(m));

  const jwt = createJwt(config);
  const ctx: AppContext = {
    config,
    db,
    log: app.log,
    jwt,
    mailer: opts.mailer ?? createMailer(config, app.log),
    sessions: createSessions(db, config, jwt),
    codes: createCodes(db, config),
    usage: createUsage(db),
    runs: createRunHub(),
    ai: opts.ai ?? createAi(config, app.log),
    tools:
      opts.tools ??
      createTools([], { sandbox: config.SANDBOXD_URL && config.SANDBOXD_TOKEN ? createSandboxClient(config.SANDBOXD_URL, config.SANDBOXD_TOKEN) : undefined }),
  };
  const guard = createGuard(ctx);
  app.decorateRequest('user', null);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 86_400,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.isTest ? 10_000 : 240,
    timeWindow: '1 minute',
    allowList: (req) => config.isTest && !req.headers['x-test-ratelimit'],
    errorResponseBuilder: (_req, info) =>
      new HttpError(429, 'rate_limited', 'Çok fazla istek. Biraz yavaşla.', {
        retryAfter: Math.ceil(Number(info.ttl) / 1000),
      }),
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (reply.sent || reply.raw.headersSent) return;
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Geçersiz istek.', details: err.issues } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code: ErrorCode = status === 429 ? 'rate_limited' : status === 404 ? 'not_found' : 'bad_request';
      return reply.code(status).send({ error: { code, message: (err as Error).message } });
    }
    req.log.error({ err: err as Error }, 'beklenmeyen hata');
    return reply.code(500).send({ error: { code: 'internal', message: 'Sunucu hatası.' } });
  });
  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : '';
  const serveWeb = Boolean(webDist) && existsSync(resolve(webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      cacheControl: false,
      // Hash'li varlıklar sonsuza dek önbelleğe alınır; HTML ve servis çalışanı asla.
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else res.setHeader('cache-control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url === '/api';
    if (serveWeb && !isApi && req.method === 'GET') {
      // SPA: bilinmeyen yollar index.html'e düşer (/c/:id, /s/:slug ...)
      if (/\.[a-z0-9]{2,5}$/i.test(req.url.split('?')[0]!)) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Dosya bulunamadı.' } });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Böyle bir adres yok.' } });
  });

  await app.register(
    async (api) => {
      await api.register(publicRoutes(ctx));
      await api.register(authRoutes(ctx, guard));
      await api.register(meRoutes(ctx, guard));
      await api.register(chatRoutes(ctx, guard));
      await api.register(messageRoutes(ctx, guard));
    },
    { prefix: '/api' },
  );

  app.addHook('onClose', async () => {
    if (!opts.db) await db.end();
  });

  return { app, ctx };
}
