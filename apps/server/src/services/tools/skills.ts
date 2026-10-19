import { z } from 'zod';
import { ToolError } from './errors.ts';
import type { SkillRuntime } from '../skills.ts';
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
