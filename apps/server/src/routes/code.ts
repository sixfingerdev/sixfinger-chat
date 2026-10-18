import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  branchesQuery,
  createCodeEnvSchema,
  createCodeSessionSchema,
  githubStartSchema,
  listReposQuery,
  updateCodeEnvSchema,
  type CodeStatusDTO,
  type GithubRepoDTO,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

const REPO_CACHE_MS = 60_000;

export function codeRoutes(ctx: AppContext, guard: Guard) {
  const { code, github, secrets, config } = ctx;
  const repoCache = new Map<string, { at: number; repos: GithubRepoDTO[] }>();

  const backTo = (target: 'web' | 'app', ok: boolean): string =>
    target === 'app'
      ? `sixfinger://code?github=${ok ? 'ok' : 'error'}`
      : `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/code?github=${ok ? 'ok' : 'error'}`;

  /** Mobil: tarayıcılar özel şemalı yönlendirmeyi sessizce yutabilir; JS + düğmeli küçük bir sayfa göster. */
  function finish(reply: FastifyReply, target: 'web' | 'app', ok: boolean) {
    const url = backTo(target, ok);
    if (target === 'web') return reply.redirect(url);
    const msg = ok ? 'GitHub bağlandı. Uygulamaya dönebilirsin.' : 'GitHub bağlantısı kurulamadı.';
    return reply
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SixFinger</title>` +
          `<body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
          `<div><p>${msg}</p><p><a style="color:#fff" href="${url}">Uygulamaya dön</a></p></div><script>location.href=${JSON.stringify(url)}</script>`,
      );
  }

  /** İzin listesinde olmayan ya da Code kapalıyken 403. */
  async function requireCode(req: { user: NonNullable<import('fastify').FastifyRequest['user']> }) {
    if (!code.enabled) throw new HttpError(503, 'upstream_unavailable', 'Code bu sunucuda ayarlanmamış.');
    if (!code.isAllowed(req.user)) throw forbidden('Code için erişimin yok.');
  }

  async function tokenOf(userId: string): Promise<string> {
    const conn = await code.getConnection(userId);
    if (!conn) throw new HttpError(409, 'github_required', 'Önce GitHub hesabını bağla.');
    return conn.token;
  }

  return async function (app: FastifyInstance) {
    // --- GitHub geri dönüşü: tarayıcıdan gelir, oturum başlığı yoktur; kimlik imzalı `state` ile doğrulanır ---
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/code/github/callback',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const st = secrets?.verifyState<{ u: string; t: 'web' | 'app' }>(req.query.state ?? '');
        if (!st || !code.enabled) return reply.code(400).type('text/plain').send('Geçersiz ya da süresi dolmuş istek.');
        const target = st.t === 'app' ? 'app' : 'web';
        if (req.query.error || !req.query.code) return finish(reply, target, false);
        try {
          const { token, scope } = await github.exchange(req.query.code);
          const who = await github.user(token);
          await code.saveConnection(st.u, who, token, scope);
          return finish(reply, target, true);
        } catch (err) {
          req.log.warn({ err }, 'GitHub bağlantısı kurulamadı');
          return finish(reply, target, false);
        }
      },
    );

    await app.register(async (authed) => {
      authed.addHook('preHandler', guard.requireUser);

      authed.get('/code/status', async (req): Promise<CodeStatusDTO> => {
        const user = req.user!;
        const allowed = code.isAllowed(user);
        const conn = allowed ? await code.getConnection(user.id) : null;
        return {
          available: code.enabled,
          allowed,
          github: conn ? { login: conn.login, avatarUrl: conn.avatarUrl } : null,
          credits: allowed
            ? await code.credits(user.id)
            : { used: 0, limit: config.CODE_DAILY_CREDITS, resetsAt: new Date().toISOString() },
        };
      });

      authed.addHook('preHandler', async (req) => {
        if (req.url.split('?')[0]!.endsWith('/code/status')) return;
        await requireCode({ user: req.user! });
      });

      // --- GitHub ---
      authed.post('/code/github/start', async (req) => {
        const { target } = parse(githubStartSchema, req.body);
        const state = secrets!.signState({ u: req.user!.id, t: target }, 600);
        return { url: github.authorizeUrl(state) };
      });

      authed.delete('/code/github', async (req, reply) => {
        const token = await code.removeConnection(req.user!.id);
        repoCache.delete(req.user!.id);
        if (token) void github.revoke(token);
        return reply.code(204).send();
      });

      authed.get('/code/repos', async (req) => {
        const user = req.user!;
        const { q } = parse(listReposQuery, req.query);
        const token = await tokenOf(user.id);
        let hit = repoCache.get(user.id);
        if (!hit || Date.now() - hit.at > REPO_CACHE_MS) {
          hit = { at: Date.now(), repos: await github.repos(token) };
          repoCache.set(user.id, hit);
          if (repoCache.size > 500) repoCache.clear();
        }
        const needle = q?.toLowerCase();
        const repos = needle
          ? hit.repos.filter((r) => r.fullName.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle))
          : hit.repos;
        return { repos: repos.slice(0, 100) };
      });

      authed.get('/code/branches', async (req) => {
        const { repo } = parse(branchesQuery, req.query);
        return github.branches(await tokenOf(req.user!.id), repo);
      });

      // --- Ortamlar ---
      authed.get('/code/environments', async (req) => ({ environments: await code.listEnvironments(req.user!.id) }));

      authed.get<{ Params: { id: string } }>('/code/environments/:id', async (req) => ({
        environment: await code.getEnvironment(req.user!.id, req.params.id),
      }));

      authed.post('/code/environments', async (req, reply) => {
        const body = parse(createCodeEnvSchema, req.body);
        return reply.code(201).send({ environment: await code.createEnvironment(req.user!.id, body) });
      });

      authed.patch<{ Params: { id: string } }>('/code/environments/:id', async (req) => {
        const body = parse(updateCodeEnvSchema, req.body);
        return { environment: await code.updateEnvironment(req.user!.id, req.params.id, body) };
      });

      authed.delete<{ Params: { id: string } }>('/code/environments/:id', async (req, reply) => {
        if (!(await code.deleteEnvironment(req.user!.id, req.params.id))) throw notFound('Ortam bulunamadı.');
        return reply.code(204).send();
      });

      // --- Oturumlar ---
      authed.get('/code/sessions', async (req) => ({ sessions: await code.listSessions(req.user!.id) }));

      authed.get<{ Params: { id: string } }>('/code/sessions/:id', async (req) => {
        const session = await code.getSession(req.user!.id, req.params.id);
        if (!session) throw notFound('Oturum bulunamadı.');
        return { session };
      });

      authed.post('/code/sessions', async (req, reply) => {
        const user = req.user!;
        const body = parse(createCodeSessionSchema, req.body);
        const token = await tokenOf(user.id);
        const { branches } = await github.branches(token, body.repo);
        if (!branches.includes(body.baseBranch)) throw badRequest('Bu branch repoda yok.');
        return reply.code(201).send({ session: await code.createSession(user.id, body) });
      });

      authed.delete<{ Params: { id: string } }>('/code/sessions/:id', async (req, reply) => {
        if (!(await code.deleteSession(req.user!.id, req.params.id))) throw notFound('Oturum bulunamadı.');
        return reply.code(204).send();
      });
    });
  };
}
