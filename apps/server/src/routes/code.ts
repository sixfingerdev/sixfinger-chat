import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  branchesQuery,
  createCodeEnvSchema,
  createPrSchema,
  createCodeSessionSchema,
  diffQuery,
  filesQuery,
  rewindSchema,
  githubCompleteSchema,
  githubStartSchema,
  listReposQuery,
  updateCodeEnvSchema,
  type CodeChangesDTO,
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

  const webBase = config.PUBLIC_WEB_URL.replace(/\/$/, '');

  /**
   * GitHub geri dönüşü oturumsuz bir tarayıcı isteğidir; hesabı bağlamaz, yalnızca kodu istemciye taşır.
   * Bağlantıyı istemci kendi oturumuyla tamamlar (`/code/github/complete`), böylece saldırganın başlattığı bir akış
   * kurbanın GitHub hesabını saldırganın hesabına bağlayamaz.
   */
  function bounce(reply: FastifyReply, target: 'web' | 'app', params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    if (target === 'web') return reply.redirect(`${webBase}/code?${qs}`);
    // Mobil: tarayıcılar özel şemalı yönlendirmeyi sessizce yutabilir; JS + düğmeli küçük bir sayfa göster.
    const url = `sixfinger://code?${qs}`;
    const msg = params.github === 'error' ? 'GitHub bağlantısı kurulamadı.' : 'GitHub yetkisi alındı. Uygulamaya dönülüyor…';
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SixFinger</title>` +
          `<body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
          `<div><p>${msg}</p><p><a style="color:#fff" href="${url.replace(/&/g, '&amp;')}">Uygulamaya dön</a></p></div><script>location.href=${JSON.stringify(url).replace(/</g, '\\u003c')}</script>`,
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
    // --- GitHub geri dönüşü: tarayıcıdan gelir, oturum başlığı yoktur; yalnızca imzalı `state`i doğrular ve istemciye yönlendirir ---
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/code/github/callback',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const state = req.query.state ?? '';
        const st = secrets?.verifyState<{ u: string; t: 'web' | 'app' }>(state);
        if (!st || !code.enabled) return reply.code(400).type('text/plain').send('Geçersiz ya da süresi dolmuş istek.');
        const target = st.t === 'app' ? 'app' : 'web';
        if (req.query.error || !req.query.code) return bounce(reply, target, { github: 'error' });
        return bounce(reply, target, { gh_code: req.query.code, gh_state: state });
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

      /** Bağlantıyı tamamlar: state'i başlatan kullanıcı ile bu isteği yapan oturum aynı olmalı. */
      authed.post('/code/github/complete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        const user = req.user!;
        const body = parse(githubCompleteSchema, req.body);
        const st = secrets!.verifyState<{ u: string }>(body.state);
        if (!st || st.u !== user.id) throw badRequest('GitHub bağlantı isteği geçersiz ya da süresi dolmuş. Tekrar dene.');
        const { token, scope } = await github.exchange(body.code);
        const who = await github.user(token);
        await code.saveConnection(user.id, who, token, scope);
        repoCache.delete(user.id);
        return { github: { login: who.login, avatarUrl: who.avatarUrl } };
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
      authed.get<{ Querystring: { archived?: string } }>('/code/sessions', async (req) => {
        await code.reconcileRunning(ctx.runs.activeChatIds());
        return { sessions: await code.listSessions(req.user!.id, req.query.archived === 'true' || req.query.archived === '1') };
      });

      authed.get<{ Params: { id: string } }>('/code/sessions/:id', async (req) => {
        await code.reconcileRunning(ctx.runs.activeChatIds());
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

      /** Oturumun çalışma branch'indeki PR'lar (başlıktaki PR düğmesi). */
      authed.get<{ Params: { id: string } }>('/code/sessions/:id/pulls', async (req) => {
        const user = req.user!;
        const session = await code.getSession(user.id, req.params.id);
        if (!session) throw notFound('Oturum bulunamadı.');
        return { pulls: await github.pulls(await tokenOf(user.id), session.repo, session.workBranch) };
      });

      /** Değişen dosyalar (+N −M). Ajan çalışırken ya da çalışma alanı uykudayken son bilinen toplam (`stale`) döner. */
      authed.get<{ Params: { id: string } }>('/code/sessions/:id/changes', async (req) => {
        const user = req.user!;
        const session = await code.getSession(user.id, req.params.id);
        if (!session) throw notFound('Oturum bulunamadı.');
        const stale: CodeChangesDTO = { files: [], additions: session.additions, deletions: session.deletions, stale: true };
        if (!ctx.codeSandbox || ctx.runs.activeChatIds().includes(session.chatId)) return stale;
        try {
          const ch = await ctx.codeSandbox.changes({ user: user.id, session: `${user.id}:${session.chatId}` }, AbortSignal.timeout(20_000));
          return { files: ch.files, additions: ch.additions, deletions: ch.deletions, stale: false } satisfies CodeChangesDTO;
        } catch {
          return stale;
        }
      });

      /** Branch'i GitHub'a gönderir (ajan çalışırken `409`). */
      authed.post<{ Params: { id: string } }>('/code/sessions/:id/push', async (req) => ctx.codeGit.push(req.user!, req.params.id));

      /**
       * PR'ı ajan açar (tur sonunda kendiliğinden). Bu uç, otomatik adım başarısız olduğunda ya da ortamda "Otomatik PR" kapalıyken
       * tek dokunuşla yeniden denemek içindir: başlık/açıklamayı model yazar.
       */
      authed.post<{ Params: { id: string } }>('/code/sessions/:id/pr', async (req) => {
        const body = parse(createPrSchema, req.body ?? {});
        return ctx.codeGit.publish(req.user!, req.params.id, body);
      });

      /** Repodaki slash komutları (`.claude/commands`, `.sixfinger/commands`). */
      authed.get<{ Params: { id: string } }>('/code/sessions/:id/commands', async (req) => ({ commands: await ctx.codeGit.commands(req.user!, req.params.id) }));

      /** Çalışma alanındaki dosyalar (`q` ile süzülür): @dosya önerisi ve dosya gezgini. */
      authed.get<{ Params: { id: string }; Querystring: { q?: string } }>('/code/sessions/:id/files', async (req) => {
        const q = parse(filesQuery, req.query);
        return ctx.codeGit.files(req.user!, req.params.id, q.q);
      });

      /** Tek dosyanın içeriği (dosya gezgini). */
      authed.get<{ Params: { id: string }; Querystring: { path?: string } }>('/code/sessions/:id/file', async (req) => {
        const q = parse(diffQuery, req.query);
        if (!q.path) throw badRequest('path gerekli.');
        return ctx.codeGit.readFile(req.user!, req.params.id, q.path);
      });

      /** Çalışma alanını tar.gz olarak indirir. */
      authed.get<{ Params: { id: string } }>('/code/sessions/:id/archive', async (req, reply) => {
        const a = await ctx.codeGit.archive(req.user!, req.params.id);
        return reply
          .header('content-disposition', `attachment; filename="${a.filename.replace(/[^\w.-]/g, '_')}"`)
          .header('cache-control', 'no-store')
          .type('application/gzip')
          .send(a.data);
      });

      /** Çalışma alanını ve sohbeti bu asistan mesajının sonuna geri sarar (checkpoint). */
      authed.post<{ Params: { id: string } }>('/code/sessions/:id/rewind', async (req) => {
        const body = parse(rewindSchema, req.body);
        const r = await ctx.codeGit.rewind(req.user!, req.params.id, body.messageId);
        return { ...r, session: await code.getSession(req.user!.id, req.params.id) };
      });

      /** Başlangıca göre birleşik fark (tüm dosyalar ya da tek `path`). */
      authed.get<{ Params: { id: string }; Querystring: { path?: string } }>('/code/sessions/:id/diff', async (req) => {
        const q = parse(diffQuery, req.query);
        return ctx.codeGit.diff(req.user!, req.params.id, q.path);
      });

      authed.delete<{ Params: { id: string } }>('/code/sessions/:id', async (req, reply) => {
        if (!(await code.deleteSession(req.user!.id, req.params.id))) throw notFound('Oturum bulunamadı.');
        return reply.code(204).send();
      });
    });
  };
}
