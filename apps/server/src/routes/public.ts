import type { FastifyInstance } from 'fastify';
import type { SharedChatDTO } from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import { notFound } from '../lib/errors.ts';

export function publicRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get('/health', async () => {
      await ctx.db.query('select 1');
      return { ok: true, time: new Date().toISOString() };
    });

    app.get<{ Params: { slug: string } }>(
      '/public/shares/:slug',
      { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
      async (req): Promise<SharedChatDTO> => {
        const r = await ctx.db.query<{ slug: string; title: string; snapshot: SharedChatDTO['messages']; created_at: Date }>(
          'select slug, title, snapshot, created_at from shares where slug = $1',
          [req.params.slug.slice(0, 32)],
        );
        const s = r.rows[0];
        if (!s) throw notFound('Paylaşılan sohbet bulunamadı.');
        return { slug: s.slug, title: s.title, createdAt: s.created_at.toISOString(), messages: s.snapshot };
      },
    );
  };
}
