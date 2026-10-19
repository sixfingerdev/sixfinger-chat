import { z } from 'zod';
import { ToolError } from './errors.ts';
import type { ToolContext, ToolDef, ToolResult } from './types.ts';

/**
 * Claude Code'un ajan düzeyi araçları: alt ajan (task), kullanıcıya soru (ask_user) ve plan modundan çıkış (exit_plan_mode).
 * Soru ve plan araçları turu bitirir ("terminal"): kullanıcı yanıt verince yeni turla devam edilir.
 */

/** Sonucu `meta.terminal: true` olan araçlar turu sonlandırır. */
export const TERMINAL_TOOLS = new Set(['ask_user', 'exit_plan_mode']);

/** Plan modunda izin verilen araçlar: yalnızca okuma/araştırma + soru/plan. */
export const PLAN_TOOLS = new Set(['read', 'glob', 'grep', 'todo', 'skill', 'web_search', 'web_fetch', 'task', 'ask_user', 'exit_plan_mode']);

const available = () => true;

function parse<T extends z.ZodTypeAny>(tool: string, schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 5).map((i) => `- ${i.path.join('.') || 'arguments'}: ${i.message}`);
  throw new ToolError(`Invalid arguments for tool "${tool}":\n${issues.join('\n')}\nUpdate the arguments and call the tool again.`);
}

const option = z.object({ label: z.string().trim().min(1).max(80), description: z.string().trim().max(300).optional() });
const question = z.object({
  question: z.string().trim().min(3).max(300),
  header: z.string().trim().max(24).optional(),
  options: z.array(option).min(2).max(4),
  multiSelect: z.boolean().optional(),
});
const askArgs = z.object({ questions: z.array(question).min(1).max(4) });

export function createAskUserTool(): ToolDef {
  return {
    name: 'ask_user',
    description:
      'Asks the user one to four multiple-choice questions when you need a decision you cannot make yourself (several valid approaches that change the result, or missing information that is not in the repository). ' +
      'Each question has 2-4 concrete options (the user can also type their own answer). Calling this tool ENDS your turn: stop after it and wait for the answer, which arrives as the next user message. Do not use it for things you can find out with your tools or decide reasonably yourself.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1-4 questions.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The full question, ending with a question mark.' },
              header: { type: 'string', description: 'A very short label (max 24 characters).' },
              options: {
                type: 'array',
                description: '2-4 options.',
                items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string', description: 'What choosing it means.' } }, required: ['label'] },
              },
              multiSelect: { type: 'boolean', description: 'Allow choosing several options.' },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
    aliases: { questions: ['question', 'items', 'qs'] },
    available,
    async run(raw): Promise<ToolResult> {
      const a = parse('ask_user', askArgs, raw);
      return {
        output: 'The question was shown to the user. End your turn now; the answer will arrive as the next user message.',
        summary: `${a.questions.length} question${a.questions.length > 1 ? 's' : ''}`,
        meta: { terminal: true, questions: a.questions },
      };
    },
  };
}

export function createExitPlanTool(): ToolDef {
  return {
    name: 'exit_plan_mode',
    description:
      'Presents your finished plan to the user for approval and ends plan mode. Call it exactly once, after you have explored the code and (if needed) asked your questions. ' +
      'The plan must be concrete Markdown: the goal, the files you will change and how, the steps in order, and how you will verify the result. Calling this tool ENDS your turn; nothing is changed until the user approves.',
    parameters: { type: 'object', properties: { plan: { type: 'string', description: 'The plan in Markdown.' } }, required: ['plan'] },
    aliases: { plan: ['markdown', 'content', 'text', 'plan_text'] },
    available,
    async run(raw): Promise<ToolResult> {
      const a = parse('exit_plan_mode', z.object({ plan: z.string().trim().min(20).max(20_000) }), raw);
      return {
        output: 'The plan was shown to the user for approval. End your turn now; implementation starts only after the user approves.',
        summary: `${a.plan.split('\n').filter((l) => l.trim()).length} lines`,
        meta: { terminal: true, plan: a.plan },
      };
    },
  };
}

export interface SubagentReport {
  text: string;
  steps: number;
  tools: Record<string, number>;
  stopped?: 'context' | 'credits' | 'loop';
}

const taskArgs = z.object({
  description: z.string().trim().min(3).max(80),
  prompt: z.string().trim().min(10).max(12_000),
  agent: z.enum(['explore', 'general']).optional(),
});

/** Alt ajan: kendi taze bağlamında çalışıp yalnızca kısa bir rapor döndürür (ana bağlamı şişirmez). */
export function createTaskTool(runSub: (a: { description: string; prompt: string; agent: 'explore' | 'general' }, ctx: ToolContext) => Promise<SubagentReport>): ToolDef {
  return {
    name: 'task',
    description:
      'Delegates a self-contained job to a sub-agent that works in its own fresh context and returns a short report. Use it for broad investigations (finding where something is implemented, understanding an unfamiliar module, comparing several files) so that you do not fill your own context with file contents. ' +
      'The sub-agent knows NOTHING about this conversation: put every detail it needs in prompt, and say what the report must contain. agent="explore" (default) is read-only (read, glob, grep, web); agent="general" can also run commands and edit files. ' +
      'You can call task several times in one turn. Do not delegate trivial lookups you can do with one grep or read.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short title of the job (3-8 words).' },
        prompt: { type: 'string', description: 'The complete, self-contained instructions for the sub-agent, including what to report back.' },
        agent: { type: 'string', enum: ['explore', 'general'], description: 'explore = read-only (default); general = may run commands and edit files.' },
      },
      required: ['description', 'prompt'],
    },
    aliases: { description: ['title', 'name', 'summary'], prompt: ['task', 'instructions', 'goal', 'message'], agent: ['type', 'subagent_type', 'kind'] },
    maxOutputChars: 10_000,
    available,
    async run(raw, ctx): Promise<ToolResult> {
      const a = parse('task', taskArgs, raw);
      const r = await runSub({ description: a.description, prompt: a.prompt, agent: a.agent ?? 'explore' }, ctx);
      const head = r.stopped ? `[The sub-agent stopped early (${r.stopped}); this is what it had so far]\n` : '';
      return {
        output: `${head}${r.text.trim() || '(the sub-agent returned no text)'}`,
        summary: `${r.steps} step${r.steps === 1 ? '' : 's'}`,
        meta: { description: a.description, agent: a.agent ?? 'explore', steps: r.steps, tools: r.tools, stopped: r.stopped ?? null },
      };
    },
  };
}
