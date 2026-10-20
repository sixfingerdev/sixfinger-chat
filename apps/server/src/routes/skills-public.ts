import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.ts';
import { defaultSkillsDir, walkFiles } from '../services/skills.ts';

/**
 * Yerleşik skill'lerin herkese açık kataloğu (SixFinger Code CLI `skills.urls` biçimi):
 * `GET /api/skills/index.json` → `{skills:[{name, files, version}]}`, `GET /api/skills/:ad/<dosya>`.
 * Yalnızca ürünle gelen yerleşik skill'ler; kullanıcı skill'leri ve gizli veri burada yoktur.
 * `version` içeriğin özetidir: CLI yalnızca değişince yeniden indirir.
 */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TTL_MS = 60_000;

interface Entry {
  name: string;
  files: string[];
  version: string;
}

export function skillsPublicRoutes(dir = defaultSkillsDir()) {
  let cache: { at: number; list: Entry[] } | null = null;

  function list(): Entry[] {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
    const out: Entry[] = [];
    if (existsSync(dir)) {
      for (const name of readdirSync(dir).sort()) {
        const root = join(dir, name);
        if (!NAME.test(name) || !statSync(root).isDirectory() || !existsSync(join(root, 'SKILL.md'))) continue;
        const files = walkFiles(root).sort();
        const h = createHash('sha1');
        for (const f of files) h.update(f).update('\0').update(readFileSync(join(root, f)));
        out.push({ name, files, version: h.digest('hex').slice(0, 12) });
      }
    }
    cache = { at: Date.now(), list: out };
    return out;
  }

  return async function (app: FastifyInstance) {
    app.get('/skills/index.json', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return { skills: list() };
    });

    app.get<{ Params: { name: string; '*': string } }>('/skills/:name/*', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
      const entry = list().find((s) => s.name === req.params.name);
      const rel = normalize(req.params['*']).split(sep).join('/');
      // yalnızca dizindeki listelenen dosyalar (yol dışına çıkış imkânsız)
      if (!entry || !entry.files.includes(rel)) throw notFound('Dosya bulunamadı.');
      reply.header('cache-control', 'public, max-age=60').type(rel.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
      return readFileSync(join(dir, entry.name, rel), 'utf8');
    });
  };
}
