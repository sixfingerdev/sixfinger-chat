import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import { SandboxBusyError, SandboxError } from './runtime/types.ts';
import type { SandboxService } from './service.ts';
import type { CodeService } from './code.ts';

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

const codeWho = { user: z.string().min(1).max(80), session: z.string().min(1).max(200) };
const prepareBody = z.object({
  ...codeWho,
  repo: z.string().min(3).max(201),
  base_branch: z.string().min(1).max(200),
  work_branch: z.string().min(1).max(200),
  token: z.string().max(500).optional(),
  author: z.object({ name: z.string().min(1).max(100), email: z.string().min(3).max(200) }).optional(),
  network: z.object({ mode: z.enum(['none', 'trusted', 'full', 'custom']), domains: z.array(z.string().max(253)).max(50).default([]) }),
  disk_mb: z.number().int().min(64).max(4096),
  setup_script: z.string().max(4_000).default(''),
  env: z.record(z.string().max(4_000)).default({}),
  clone_url: z.string().max(500).optional(),
});
const codeExecBody = z.object({ ...codeWho, command: z.string().min(1).max(8_000), timeout_seconds: z.number().int().min(1).max(3_600).optional() });
const codeReadBody = z.object({ ...codeWho, path: z.string().min(1).max(400) });
const codeWriteBody = z.object({ ...codeWho, path: z.string().min(1).max(400), content: z.string().max(4_000_000) });
const codeGlobBody = z.object({ ...codeWho, pattern: z.string().min(1).max(300), path: z.string().max(400).optional(), limit: z.number().int().min(1).max(1_000).optional() });
const codeGrepBody = z.object({
  ...codeWho,
  pattern: z.string().min(1).max(500),
  path: z.string().max(400).optional(),
  include: z.string().max(200).optional(),
  literal: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
});
const codeCommitBody = z.object({ ...codeWho, message: z.string().max(2_000) });

export function buildServer(service: SandboxService, cfg: Config, opts: { logger?: boolean | object; code?: CodeService } = {}): FastifyInstance {
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
      const status = err.code === 'not_found' ? 404 : err.code === 'too_large' ? 413 : err.code === 'internal' ? 500 : err.code === 'not_prepared' ? 409 : err.code === 'disk_full' ? 507 : 400;
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

  const code = opts.code;
  if (code) {
    app.get('/v1/code/stats', async () => code.stats());
    app.post('/v1/code/prepare', async (req) => {
      const b = prepareBody.parse(req.body);
      return code.prepare({
        user: b.user, session: b.session, repo: b.repo, baseBranch: b.base_branch, workBranch: b.work_branch, token: b.token, author: b.author,
        network: b.network, diskMb: b.disk_mb, setupScript: b.setup_script, env: b.env, cloneUrl: b.clone_url,
      });
    });
    app.post('/v1/code/exec', async (req) => {
      const b = codeExecBody.parse(req.body);
      return code.exec(b.user, b.session, b.command, b.timeout_seconds);
    });
    app.post('/v1/code/read', async (req) => {
      const b = codeReadBody.parse(req.body);
      return code.readFile(b.user, b.session, b.path);
    });
    app.post('/v1/code/write', async (req) => {
      const b = codeWriteBody.parse(req.body);
      return code.writeFile(b.user, b.session, b.path, b.content);
    });
    app.post('/v1/code/glob', async (req) => {
      const b = codeGlobBody.parse(req.body);
      return code.glob(b.user, b.session, b.pattern, b.path, b.limit);
    });
    app.post('/v1/code/grep', async (req) => {
      const b = codeGrepBody.parse(req.body);
      return code.grep(b.user, b.session, { pattern: b.pattern, path: b.path, include: b.include, literal: b.literal, caseSensitive: b.case_sensitive, limit: b.limit });
    });
    app.post('/v1/code/changes', async (req) => {
      const b = z.object(codeWho).parse(req.body);
      return code.changes(b.user, b.session);
    });
    app.post('/v1/code/commit', async (req) => {
      const b = codeCommitBody.parse(req.body);
      return code.commit(b.user, b.session, b.message);
    });
    app.post('/v1/code/usage', async (req) => {
      const b = z.object(codeWho).parse(req.body);
      return code.usage(b.user, b.session);
    });
    app.post('/v1/code/destroy', async (req, reply) => {
      const b = z.object(codeWho).parse(req.body);
      await code.destroy(b.user, b.session);
      return reply.code(204).send();
    });
  }

  return app;
}
