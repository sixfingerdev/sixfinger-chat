import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import { SandboxBusyError, SandboxError } from './runtime/types.ts';
import type { SandboxService } from './service.ts';

const who = { user: z.string().min(1).max(80), session: z.string().min(1).max(200) };
const execBody = z.object({ ...who, command: z.string().min(1).max(8_000), timeout_seconds: z.number().int().min(1).max(600).optional() });
const readBody = z.object({ ...who, path: z.string().min(1).max(400) });
const writeBody = z.object({ ...who, path: z.string().min(1).max(400), content: z.string().max(2_000_000) });
const editBody = z.object({
  ...who,
  path: z.string().min(1).max(400),
  old_string: z.string().max(200_000),
  new_string: z.string().max(200_000),
  replace_all: z.boolean().optional(),
});
const listBody = z.object(who);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function buildServer(service: SandboxService, cfg: Config, opts: { logger?: boolean | object } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? { level: cfg.LOG_LEVEL }, bodyLimit: 4 * 1024 * 1024 });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(token, cfg.SANDBOXD_TOKEN)) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Yetkisiz.' } });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SandboxBusyError) {
      return reply.code(503).header('retry-after', String(err.retryAfterSeconds)).send({ error: { code: 'busy', message: err.message, retryAfter: err.retryAfterSeconds } });
    }
    if (err instanceof SandboxError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'too_large' ? 413 : err.code === 'internal' ? 500 : 400;
      return reply.code(status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: { code: 'bad_request', message: err.issues[0]?.message ?? 'Geçersiz istek.' } });
    }
    app.log.error({ err }, 'beklenmeyen hata');
    return reply.code(500).send({ error: { code: 'internal', message: 'Beklenmeyen hata.' } });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/v1/stats', async () => ({ ...service.stats(), health: await service.runtime.health() }));

  app.post('/v1/exec', async (req) => {
    const b = execBody.parse(req.body);
    return service.exec(b.user, b.session, b.command, b.timeout_seconds);
  });
  app.post('/v1/read', async (req) => {
    const b = readBody.parse(req.body);
    return service.readFile(b.user, b.session, b.path);
  });
  app.post('/v1/write', async (req) => {
    const b = writeBody.parse(req.body);
    return service.writeFile(b.user, b.session, b.path, b.content);
  });
  app.post('/v1/edit', async (req) => {
    const b = editBody.parse(req.body);
    return service.editFile(b.user, b.session, b.path, b.old_string, b.new_string, b.replace_all);
  });
  app.post('/v1/files', async (req) => {
    const b = listBody.parse(req.body);
    return { files: await service.listFiles(b.user, b.session) };
  });
  app.post('/v1/destroy', async (req, reply) => {
    const b = listBody.parse(req.body);
    await service.destroy(b.user, b.session);
    return reply.code(204).send();
  });

  return app;
}
