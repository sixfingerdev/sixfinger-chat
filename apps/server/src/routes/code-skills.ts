import type { FastifyInstance } from 'fastify';
import {
  SKILL_LIMITS,
  importSharedSkillSchema,
  importSkillSchema,
  parseGithubSkillUrl,
  parseSkillMd,
  saveSkillSchema,
  serializeSkillMd,
  shareSkillSchema,
  type SkillDetailDTO,
  type SkillListItemDTO,
} from '@sixfinger/shared';
import type { AppContext } from '../context.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import type { SkillBundle, UserSkill } from '../services/skills.ts';

const detailOf = (b: SkillBundle, extra: Partial<SkillListItemDTO> = {}): SkillDetailDTO => ({
  name: b.summary.name,
  description: b.summary.description,
  source: b.summary.source === 'builtin' ? 'builtin' : 'user',
  triggers: b.summary.triggers,
  fileCount: Object.keys(b.files).length,
  markdown: serializeSkillMd({ name: b.summary.name, description: b.summary.description, triggers: b.summary.triggers, body: b.body }),
  body: b.body,
  files: b.files,
  ...extra,
});
const userExtra = (u: UserSkill): Partial<SkillListItemDTO> => ({ shareToken: u.shareToken, importedFrom: u.importedFrom, updatedAt: u.updatedAt });
const listItem = (d: SkillDetailDTO): SkillListItemDTO => ({ name: d.name, description: d.description, source: d.source, triggers: d.triggers, fileCount: d.fileCount, shareToken: d.shareToken, importedFrom: d.importedFrom, updatedAt: d.updatedAt });

/** Skill uçları: listele, oku, kaydet, sil, GitHub'dan içe aktar, bağlantıyla paylaş. Kimlik ve Code izni üst kapsamdan gelir. */
export function registerSkillRoutes(authed: FastifyInstance, ctx: AppContext) {
  const { skills, github, code } = ctx;

  async function saveParsed(userId: string, markdown: string, files: Record<string, string>, fallbackName: string | undefined, importedFrom: string | null, overwrite = true) {
    const p = parseSkillMd(markdown, fallbackName);
    if (!p.ok) throw badRequest(p.error);
    if (skills.builtin.has(p.skill.name)) throw conflict(`"${p.skill.name}" yerleşik bir skill'in adı; yerleşik skill'ler değiştirilemez. Başka bir ad seç.`);
    if (!overwrite && (await skills.store.get(userId, p.skill.name))) throw conflict(`"${p.skill.name}" adında bir skill'in zaten var.`);
    return skills.store.save(userId, p.skill, files, importedFrom);
  }

  authed.get('/code/skills', async (req) => {
    const mine = await skills.store.list(req.user!.id);
    const own = new Set(mine.map((u) => u.summary.name));
    const items = [
      ...skills.listBuiltin().map((b) => listItem(detailOf(b))),
      ...mine.map((u) => listItem(detailOf(u, userExtra(u)))),
    ];
    return { skills: items.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source)), limits: { perUser: SKILL_LIMITS.perUser, own: own.size } };
  });

  /** Oturumun etkin kataloğu (repo skill'leri dahil): oturum ekranı ve /slash için. */
  authed.get<{ Params: { id: string } }>('/code/sessions/:id/skills', async (req) => {
    if (!(await code.getSession(req.user!.id, req.params.id))) throw notFound('Oturum bulunamadı.');
    const running = ctx.runs.activeChatIds().includes(req.params.id);
    const cat = await ctx.codeGit.skillCatalog(req.user!, req.params.id, !running).catch(() => skills.catalog(req.user!.id, []));
    return { skills: cat.list };
  });

  authed.get<{ Params: { name: string }; Querystring: { source?: string } }>('/code/skills/:name', async (req) => {
    const name = req.params.name.toLowerCase();
    const mine = req.query.source === 'builtin' ? null : await skills.store.get(req.user!.id, name);
    const b0 = skills.getBuiltin(name);
    if (mine && !b0) return detailOf(mine, userExtra(mine));
    const b = b0;
    if (!b) throw notFound('Skill bulunamadı.');
    return detailOf(b);
  });

  authed.put<{ Params: { name: string } }>('/code/skills/:name', async (req) => {
    const body = parse(saveSkillSchema, req.body);
    const name = req.params.name.toLowerCase();
    const p = parseSkillMd(body.markdown, name);
    if (p.ok && p.skill.name !== name) throw badRequest('Skill adı değiştirilemez; yeni ad için yeni skill oluştur.');
    const u = await saveParsed(req.user!.id, body.markdown, body.files ?? {}, name, null);
    return detailOf(u, userExtra(u));
  });

  authed.post('/code/skills', async (req, reply) => {
    const body = parse(saveSkillSchema, req.body);
    const u = await saveParsed(req.user!.id, body.markdown, body.files ?? {}, undefined, null, false);
    return reply.code(201).send(detailOf(u, userExtra(u)));
  });

  authed.delete<{ Params: { name: string } }>('/code/skills/:name', async (req, reply) => {
    if (!(await skills.store.remove(req.user!.id, req.params.name.toLowerCase()))) throw notFound('Skill bulunamadı.');
    return reply.code(204).send();
  });

  /** GitHub'dan içe aktar: skill klasörü (ya da içinde tek skill barındıran depo). Bağlıysa kullanıcının token'ı, değilse herkese açık okuma. */
  authed.post('/code/skills/import', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(importSkillSchema, req.body);
    const ref = parseGithubSkillUrl(body.url);
    if (!ref) throw badRequest('GitHub adresi anlaşılamadı. Örnek: https://github.com/sahip/depo/tree/main/skills/ad');
    const conn = await code.getConnection(req.user!.id).catch(() => null);
    const token = conn?.token;
    const candidates = ref.path ? [ref.path] : ['', 'skills', '.sixfinger/skills', '.claude/skills', '.agents/skills'];
    for (const base of candidates) {
      const { files, skipped } = await github.readFolder(token, ref.repo, base, ref.ref);
      let dirs: Array<{ path: string; files: Record<string, string> }> = [];
      if (files['SKILL.md']) dirs = [{ path: base, files }];
      else {
        // `base` bir skill klasörü değil: altındaki tek-düzey skill klasörlerini ara (SKILL.md içerenler).
        const groups = new Map<string, Record<string, string>>();
        for (const [f, c] of Object.entries(files)) {
          const [d, ...rest] = f.split('/');
          if (rest.length) (groups.get(d!) ?? groups.set(d!, {}).get(d!)!)[rest.join('/')] = c;
        }
        dirs = [...groups.entries()].filter(([, g]) => g['SKILL.md']).map(([d, g]) => ({ path: `${base}/${d}`.replace(/^\//, ''), files: g }));
      }
      if (!dirs.length) continue;
      if (dirs.length > 5 && !ref.path) throw badRequest(`Bu depoda ${dirs.length} skill var; içe aktarmak istediğin klasörün adresini ver (…/tree/<dal>/${dirs[0]!.path}).`);
      const imported: SkillListItemDTO[] = [];
      for (const d of dirs) {
        const { 'SKILL.md': md, ...rest } = d.files;
        const u = await saveParsed(req.user!.id, md!, rest, d.path.split('/').pop(), `github:${ref.repo}/${d.path}`, body.overwrite ?? false);
        imported.push(listItem(detailOf(u, userExtra(u))));
      }
      return { imported, skipped };
    }
    throw notFound('Bu adreste SKILL.md içeren bir klasör bulunamadı.');
  });

  authed.post<{ Params: { name: string } }>('/code/skills/:name/share', async (req) => {
    const body = parse(shareSkillSchema, req.body);
    return { shareToken: await skills.store.share(req.user!.id, req.params.name.toLowerCase(), body.enabled) };
  });

  authed.get<{ Params: { token: string } }>('/code/skills/shared/:token', async (req) => {
    const u = await skills.store.bySharedToken(req.params.token);
    if (!u) throw notFound('Paylaşım bağlantısı geçersiz ya da kapatılmış.');
    return detailOf(u);
  });

  authed.post<{ Params: { token: string } }>('/code/skills/shared/:token/import', async (req) => {
    const b = parse(importSharedSkillSchema, req.body ?? {});
    const u = await skills.store.bySharedToken(req.params.token);
    if (!u) throw notFound('Paylaşım bağlantısı geçersiz ya da kapatılmış.');
    const md = serializeSkillMd({ name: u.summary.name, description: u.summary.description, triggers: u.summary.triggers, body: u.body });
    const saved = await saveParsed(req.user!.id, md, u.files, undefined, `shared:${req.params.token.slice(0, 6)}`, b.overwrite ?? false);
    return detailOf(saved, userExtra(saved));
  });
}
