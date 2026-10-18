import { z } from 'zod';
import type { AiToolCall, AiToolSpec } from '../ai.ts';
import type { AuthUser } from '../../lib/types.ts';
import { ToolError } from './errors.ts';
import type { ToolContext, ToolDef, ToolResult } from './types.ts';
import { createSandboxTools, type SandboxClient } from './sandbox.ts';
import { createWebFetchTool, createWebSearchTool } from './web.ts';

export { ToolError } from './errors.ts';
export type { ToolContext, ToolDef, ToolResult } from './types.ts';
export { createSandboxClient, type SandboxClient } from './sandbox.ts';

/** Modele geri verilen araç çıktısı için üst sınır (bağlamı şişirmemek için). */
export const MAX_TOOL_OUTPUT_CHARS = 12_000;

export interface Tools {
  /** Bu kullanıcı için kullanılabilir araçlar. */
  forUser(user: AuthUser): ToolDef[];
}

export interface ToolsOptions {
  /** sandboxd yapılandırıldıysa bash/read/write/edit araçları eklenir. */
  sandbox?: SandboxClient;
}

export function createTools(extra: ToolDef[] = [], opts: ToolsOptions = {}): Tools {
  const all: ToolDef[] = [createWebSearchTool(), createWebFetchTool(), ...(opts.sandbox ? createSandboxTools(opts.sandbox) : []), ...extra];
  return { forUser: (user) => all.filter((t) => t.available(user)) };
}

export function toolSpecs(defs: ToolDef[]): AiToolSpec[] {
  return defs.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }));
}

export interface ToolRun {
  status: 'done' | 'error';
  output: string;
  summary?: string;
  ms: number;
  args: Record<string, unknown>;
}

const argsObject = z.record(z.unknown());

/** Modelin çağrısını çalıştırır. Hata fırlatmaz: sonuç her zaman modele geri verilebilir bir metindir. */
export async function runToolCall(defs: ToolDef[], call: AiToolCall, ctx: ToolContext): Promise<ToolRun> {
  const started = Date.now();
  const finish = (status: ToolRun['status'], r: ToolResult, args: Record<string, unknown>): ToolRun => ({
    status,
    output: r.output.length > MAX_TOOL_OUTPUT_CHARS ? `${r.output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[… kısaltıldı]` : r.output,
    summary: r.summary,
    ms: Date.now() - started,
    args,
  });

  const def = defs.find((d) => d.name === call.function.name);
  if (!def) return finish('error', { output: `Hata: "${call.function.name}" adında bir araç yok.` }, {});

  let args: Record<string, unknown> = {};
  try {
    const raw = call.function.arguments.trim();
    args = raw ? argsObject.parse(JSON.parse(raw)) : {};
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
