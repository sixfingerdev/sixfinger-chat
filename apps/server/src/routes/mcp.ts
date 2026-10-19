import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  MCP_LIMITS,
  MCP_PRESETS,
  createMcpServerSchema,
  mcpApprovalDecisionSchema,
  mcpConnectSchema,
  mcpOAuthCompleteSchema,
  updateMcpServerSchema,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import type { Guard } from '../guard.ts';
import { forbidden } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

/** MCP bağlayıcıları: sunucu yönetimi, OAuth dönüşü ve araç onayları. */
export function mcpRoutes(ctx: AppContext, guard: Guard) {
  const { mcp, config } = ctx;
  const webBase = config.PUBLIC_WEB_URL.replace(/\/$/, '');

  /** GitHub kalıbı: tarayıcıdan gelen geri dönüş istemciye (web sayfası ya da uygulama) code + state ile yönlendirilir. */
  function bounce(reply: FastifyReply, target: 'web' | 'app', params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    if (target === 'web') return reply.redirect(`${webBase}/connectors?${qs}`);
    const url = `sixfinger://connectors?${qs}`;
    const msg = params.mcp === 'error' ? 'Bağlayıcı yetkisi alınamadı.' : 'Yetki alındı. Uygulamaya dönülüyor…';
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

  return async function (app: FastifyInstance) {
    // --- OAuth geri dönüşü: oturum başlığı yoktur; yalnızca imzalı `state`i doğrular ve istemciye yönlendirir ---
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/mcp/oauth/callback',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const state = req.query.state ?? '';
        const peek = mcp.peekState(state);
        if (!peek || !mcp.enabled) return reply.code(400).type('text/plain').send('Geçersiz ya da süresi dolmuş istek.');
        if (req.query.error || !req.query.code) return bounce(reply, peek.target, { mcp: 'error' });
        return bounce(reply, peek.target, { mcp_code: req.query.code, mcp_state: state });
      },
    );

    await app.register(async (authed) => {
      authed.addHook('preHandler', guard.requireUser);
      const member = (req: { user: { isGuest: boolean } | null }) => {
        if (req.user?.isGuest) throw forbidden('Bağlayıcılar için hesap oluşturman gerekir.');
      };

      authed.get('/mcp/presets', async (req) => {
        member(req);
        return {
          enabled: mcp.enabled,
          presets: MCP_PRESETS.map((p) => ({ ...p, ...mcp.presetAvailable(p) })),
        };
      });

      authed.get('/mcp/servers', async (req) => {
        member(req);
        return { enabled: mcp.enabled, servers: mcp.enabled ? await mcp.list(req.user!.id) : [], limits: MCP_LIMITS, redirectUrl: mcp.redirectUrl };
      });

      authed.post('/mcp/servers', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
        member(req);
        const body = parse(createMcpServerSchema, req.body);
        return reply.code(201).send({ server: await mcp.create(req.user!, body) });
      });

      authed.patch<{ Params: { id: string } }>('/mcp/servers/:id', async (req) => {
        member(req);
        const body = parse(updateMcpServerSchema, req.body);
        return { server: await mcp.update(req.user!.id, req.params.id, body) };
      });

      authed.delete<{ Params: { id: string } }>('/mcp/servers/:id', async (req, reply) => {
        member(req);
        await mcp.remove(req.user!.id, req.params.id);
        return reply.code(204).send();
      });

      authed.post<{ Params: { id: string } }>('/mcp/servers/:id/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        member(req);
        return { server: await mcp.refresh(req.user!.id, req.params.id) };
      });

      authed.post<{ Params: { id: string } }>('/mcp/servers/:id/connect', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        member(req);
        const body = parse(mcpConnectSchema, req.body ?? {});
        return mcp.startOAuth(req.user!.id, req.params.id, body.target);
      });

      authed.post<{ Params: { id: string } }>('/mcp/servers/:id/disconnect', async (req) => {
        member(req);
        return { server: await mcp.disconnect(req.user!.id, req.params.id) };
      });

      authed.post('/mcp/oauth/complete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
        member(req);
        const body = parse(mcpOAuthCompleteSchema, req.body);
        return { server: await mcp.completeOAuth(req.user!.id, body.code, body.state) };
      });

      authed.get<{ Params: { id: string } }>('/mcp/approvals/:id', async (req) => {
        member(req);
        return { approval: await mcp.getApproval(req.user!.id, req.params.id) };
      });

      authed.post<{ Params: { id: string } }>('/mcp/approvals/:id', async (req) => {
        member(req);
        const body = parse(mcpApprovalDecisionSchema, req.body);
        return { approval: await mcp.decideApproval(req.user!.id, req.params.id, body.decision) };
      });
    });
  };
}
