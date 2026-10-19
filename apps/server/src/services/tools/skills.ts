import { z } from 'zod';
import { SKILL_LIMITS, parseSkillMd, safeSkillPath, serializeSkillMd } from '@sixfinger/shared';
import { ToolError } from './errors.ts';
import { validateSkillFiles, type SkillRuntime } from '../skills.ts';
import type { CodeSandboxClient } from './code-client.ts';
import type { ToolContext, ToolDef } from './types.ts';

const args = z.object({
  name: z.string().trim().min(1, 'name must not be empty').max(64),
  file: z.string().trim().min(1).max(200).optional(),
});

/**
 * `skill`: bir skill'in tam talimatını (ya da bir ek dosyasını) yükler. Katalog istemde durur, gövde yalnızca istenince gelir.
 * Sonuç `[skill:` ile başlar: bağlam kırpma bu sonuçları (son birkaçını) olduğu gibi korur.
 */
export function createSkillTool(rt: SkillRuntime): ToolDef {
  return {
    name: 'skill',
    maxOutputChars: 26_000,
    description:
      'Loads the full instructions of a skill listed in the Skills section of your system prompt (an expert playbook for a kind of work). Call it BEFORE you start when a skill matches the task, then follow the instructions it returns. ' +
      'Pass file to read one of the skill\'s bundled text files (listed after the instructions). Load at most two skills for one task and do not reload a skill you already loaded.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name exactly as listed.' },
        file: { type: 'string', description: 'Optional: path of a bundled file, for example references/api.md.' },
      },
      required: ['name'],
    },
    aliases: { name: ['skill', 'skill_name', 'skillName'], file: ['path', 'reference'] },
    available: () => true,
    async run(raw, ctx: ToolContext) {
      const r = args.safeParse(raw);
      if (!r.success) throw new ToolError(`Invalid arguments for tool "skill": ${r.error.issues[0]?.message ?? 'name is required'}. Call it with {"name": "<skill>"}.`);
      if (!rt.catalog.list.length) throw new ToolError('There are no skills available in this session.');
      const out = await rt.load(r.data.name.toLowerCase(), r.data.file, ctx.signal);
      return {
        output: out.text,
        summary: r.data.file ? `${r.data.name}/${r.data.file}` : r.data.name,
        meta: { name: r.data.name.toLowerCase(), source: out.source, ...(r.data.file ? { file: r.data.file } : {}), chars: out.text.length },
      };
    },
  };
}

const createArgs = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().min(20, 'description must say what the skill does and when to use it').max(SKILL_LIMITS.description),
  triggers: z.array(z.string().trim().min(1).max(60)).max(SKILL_LIMITS.triggers).optional(),
  body: z.string().trim().min(40, 'body must contain the instructions').max(SKILL_LIMITS.body),
  files: z.record(z.string().max(SKILL_LIMITS.file)).optional(),
});

/**
 * `skill_create`: ajanın öğrendiği tekrar kullanılabilir bir yöntemi reponun `.sixfinger/skills/<ad>/` klasörüne yazar. Tur sonunda diğer
 * değişikliklerle birlikte commit edilir (PR'a girer); sonraki oturumlarda repo skill'i olarak keşfedilir. Yalnızca kullanıcı isterse kullanılır.
 */
export function createSkillCreateTool(client: CodeSandboxClient, reserved: Set<string>): ToolDef {
  return {
    name: 'skill_create',
    description:
      'Saves a reusable procedure as a skill in this repository (.sixfinger/skills/<name>/SKILL.md) so future sessions can load it. Use it ONLY when the user explicitly asks you to save, remember or document a workflow as a skill. ' +
      'Write it as a playbook: a description that says what it does and "Use when …", then numbered steps with exact commands, pitfalls and a verification step. Keep the body short and specific to this repository; put long material in files (references/…).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Lowercase letters, digits and hyphens, e.g. release-checklist.' },
        description: { type: 'string', description: 'What it does and when to use it (English, 1-3 sentences).' },
        triggers: { type: 'array', items: { type: 'string' }, description: 'Keywords the user would type (any language).' },
        body: { type: 'string', description: 'Markdown instructions.' },
        files: { type: 'object', description: 'Optional bundled text files: {"references/api.md": "…"}.' },
      },
      required: ['name', 'description', 'body'],
    },
    aliases: { body: ['instructions', 'content', 'text'], description: ['summary'] },
    available: () => true,
    async run(raw, ctx: ToolContext) {
      const r = createArgs.safeParse(raw);
      if (!r.success) throw new ToolError(`Invalid arguments for tool "skill_create": ${r.error.issues[0]?.path.join('.') || 'arguments'}: ${r.error.issues[0]?.message}.`);
      if (!ctx.code) throw new ToolError('This tool only works inside a Code session.');
      const a = r.data;
      const md = serializeSkillMd({ name: a.name.toLowerCase(), description: a.description, triggers: a.triggers, body: a.body });
      const p = parseSkillMd(md);
      if (!p.ok) throw new ToolError(p.error);
      if (reserved.has(p.skill.name)) throw new ToolError(`"${p.skill.name}" is the name of a built-in skill and is reserved. Pick another name.`);
      const files = a.files ?? {};
      const bad = validateSkillFiles(files);
      if (bad) throw new ToolError(bad);
      const scope = { user: ctx.user.id, session: ctx.code.session };
      const dir = `.sixfinger/skills/${p.skill.name}`;
      await client.write(scope, `${dir}/SKILL.md`, md, ctx.signal);
      for (const [f, c] of Object.entries(files)) {
        if (!safeSkillPath(f)) throw new ToolError(`Invalid file path: ${f}`);
        await client.write(scope, `${dir}/${f}`, c, ctx.signal);
      }
      return {
        output: `Saved the skill "${p.skill.name}" at ${dir}/SKILL.md${Object.keys(files).length ? ` (+ ${Object.keys(files).length} file(s))` : ''}. It is committed with this turn's changes and future sessions on this repository will find it in the Skills list. Tell the user where it is.`,
        summary: p.skill.name,
        meta: { name: p.skill.name, path: `${dir}/SKILL.md`, files: Object.keys(files).length },
      };
    },
  };
}
