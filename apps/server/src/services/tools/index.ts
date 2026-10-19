import { z } from 'zod';
import type { AiToolCall, AiToolSpec } from '../ai.ts';
import type { AuthUser } from '../../lib/types.ts';
import { ToolError } from './errors.ts';
import type { ToolContext, ToolDef, ToolResult } from './types.ts';
import { createSandboxTools, type SandboxClient } from './sandbox.ts';
import { createCodeTools } from './code.ts';
import type { CodeSandboxClient } from './code-client.ts';
import { repairArgs, type ParamSchema } from './repair.ts';
import { createWebFetchTool, createWebSearchTool } from './web.ts';

export { ToolError } from './errors.ts';
export type { ToolContext, ToolDef, ToolResult } from './types.ts';
export { createSandboxClient, type SandboxClient } from './sandbox.ts';
export { createCodeClient, FileNotFoundError, IsDirectoryError, NotPreparedError, type CodeSandboxClient } from './code-client.ts';

/** Modele geri verilen araç çıktısı için üst sınır (bağlamı şişirmemek için). */
export const MAX_TOOL_OUTPUT_CHARS = 12_000;

export interface Tools {
  /** Bu kullanıcı için kullanılabilir araçlar. */
  forUser(user: AuthUser): ToolDef[];
  /** SixFinger Code oturumunda kullanılabilen araçlar (bash/read/write/edit/glob/grep/todo + web). Yapılandırılmamışsa boş. */
  forCode(): ToolDef[];
}

export interface ToolsOptions {
  /** sandboxd yapılandırıldıysa bash/read/write/edit araçları eklenir. */
  sandbox?: SandboxClient;
  /** sandboxd Code uçları: Code oturumlarının araçları. */
  code?: CodeSandboxClient;
}

export function createTools(extra: ToolDef[] = [], opts: ToolsOptions = {}): Tools {
  const all: ToolDef[] = [createWebSearchTool(), createWebFetchTool(), ...(opts.sandbox ? createSandboxTools(opts.sandbox) : []), ...extra];
  const codeTools: ToolDef[] = opts.code ? [...createCodeTools(opts.code), createWebSearchTool(), createWebFetchTool()] : [];
  return { forUser: (user) => all.filter((t) => t.available(user)), forCode: () => codeTools };
}

export function toolSpecs(defs: ToolDef[]): AiToolSpec[] {
  return defs.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
}

export interface ToolRun {
  status: 'done' | 'error';
  output: string;
  summary?: string;
  /** İstemci gösterimi için yapısal veri (modele gitmez). */
  meta?: Record<string, unknown>;
  ms: number;
  args: Record<string, unknown>;
}

const argsObject = z.record(z.unknown());

/** Modelin çağrısını çalıştırır. Hata fırlatmaz: sonuç her zaman modele geri verilebilir bir metindir. */
export async function runToolCall(defs: ToolDef[], call: AiToolCall, ctx: ToolContext): Promise<ToolRun> {
  const started = Date.now();
  const def = defs.find((d) => d.name === call.function.name);
  const limit = def?.maxOutputChars ?? MAX_TOOL_OUTPUT_CHARS;
  const finish = (status: ToolRun['status'], r: ToolResult, args: Record<string, unknown>): ToolRun => ({
    status,
    output: r.output.length > limit ? `${r.output.slice(0, limit)}\n[… kısaltıldı]` : r.output,
    summary: r.summary,
    meta: r.meta,
    ms: Date.now() - started,
    args,
  });

  if (!def) {
    return finish('error', { output: `Hata: "${call.function.name}" adında bir araç yok. Kullanılabilir araçlar: ${defs.map((d) => d.name).join(', ')}.` }, {});
  }

  let args: Record<string, unknown> = {};
  try {
    const raw = call.function.arguments.trim();
    args = repairArgs(def.parameters as ParamSchema, raw ? argsObject.parse(JSON.parse(raw)) : {}, def.aliases);
  } catch {
    return finish('error', { output: 'Hata: Araç argümanları geçerli bir JSON nesnesi değil.' }, {});
  }

  try {
    return finish('done', await def.run(args, ctx), args);
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    const message = err instanceof ToolError ? err.message : 'Araç beklenmeyen bir hatayla durdu.';
    return finish('error', { output: `Hata: ${message}`, summary: message }, args);
  }
}
