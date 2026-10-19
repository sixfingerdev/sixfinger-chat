import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolError } from '../tools/errors.ts';
import type { FetchLike } from './guarded-fetch.ts';

export interface McpEndpoint {
  url: string;
  /** Her isteğe eklenen başlıklar (anahtarlar). */
  headers: Record<string, string>;
  /** OAuth ile bağlanan sunucular için. */
  authProvider?: OAuthClientProvider;
  fetchImpl: FetchLike;
}

/** Sunucu yetki istiyor ve geçerli bir OAuth token'ı yok (kullanıcı "Bağlan" demeli). */
export class McpAuthRequired extends ToolError {
  constructor(message = 'Bu bağlayıcı için yetkilendirme gerekiyor. Bağlayıcılar sayfasından “Bağlan”a bas.') {
    super(message);
    this.name = 'McpAuthRequired';
  }
}

export interface McpRemoteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface McpCallResult {
  content: Array<Record<string, unknown>>;
  structured?: unknown;
  isError: boolean;
}

export interface McpCallOpts {
  signal?: AbortSignal;
  /** Bağlanma zaman aşımı (ms). */
  connectMs?: number;
}

const newClient = () => new Client({ name: 'sixfinger', version: '1.0.0' }, { capabilities: {} });

function transportFor(kind: 'http' | 'sse', ep: McpEndpoint): Transport {
  const url = new URL(ep.url);
  const requestInit = { headers: ep.headers } as RequestInit;
  return kind === 'http'
    ? new StreamableHTTPClientTransport(url, { authProvider: ep.authProvider, requestInit, fetch: ep.fetchImpl })
    : new SSEClientTransport(url, { authProvider: ep.authProvider, requestInit, fetch: ep.fetchImpl });
}

function describe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Bir MCP sunucusuna bağlanır (önce Streamable HTTP; sunucu 400/404/405 derse eski SSE aktarımı), `fn`'i çalıştırır ve bağlantıyı kapatır.
 * Çağrı başına bağlanılır: sunucuda oturum tutulmaz. Hata durumunda kısa, kullanıcıya gösterilebilir `ToolError` fırlatılır.
 */
export async function withMcpClient<T>(ep: McpEndpoint, fn: (client: Client) => Promise<T>, opts: McpCallOpts = {}): Promise<T> {
  const connectOpts = { signal: opts.signal, timeout: opts.connectMs ?? 15_000 };
  let client = newClient();
  try {
    await client.connect(transportFor('http', ep), connectOpts);
  } catch (err) {
    await client.close().catch(() => {});
    if (err instanceof UnauthorizedError) throw new McpAuthRequired();
    if (opts.signal?.aborted) throw err;
    const code = err instanceof StreamableHTTPError ? err.code : undefined;
    if (code === 401 || code === 403) throw new McpAuthRequired();
    if (code !== 400 && code !== 404 && code !== 405) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(`MCP sunucusuna bağlanılamadı: ${describe(err)}`);
    }
    client = newClient();
    try {
      await client.connect(transportFor('sse', ep), connectOpts);
    } catch (err2) {
      await client.close().catch(() => {});
      if (err2 instanceof UnauthorizedError) throw new McpAuthRequired();
      if (opts.signal?.aborted) throw err2;
      if (err2 instanceof ToolError) throw err2;
      throw new ToolError(`MCP sunucusuna bağlanılamadı: ${describe(err2)}`);
    }
  }
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Sunucunun araç listesi (en çok `max` araç, 5 sayfa). */
export async function listMcpTools(ep: McpEndpoint, max: number, opts: McpCallOpts = {}): Promise<McpRemoteTool[]> {
  return withMcpClient(
    ep,
    async (client) => {
      const out: McpRemoteTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5 && out.length < max; page++) {
        const r = await client.listTools(cursor ? { cursor } : undefined, { signal: opts.signal, timeout: 20_000 });
        for (const t of r.tools) {
          if (out.length >= max) break;
          out.push({
            name: t.name,
            description: t.description ?? '',
            inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
            readOnly: t.annotations?.readOnlyHint === true,
          });
        }
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      return out;
    },
    opts,
  );
}

export async function callMcpTool(ep: McpEndpoint, name: string, args: Record<string, unknown>, timeoutMs: number, opts: McpCallOpts = {}): Promise<McpCallResult> {
  return withMcpClient(
    ep,
    async (client) => {
      try {
        const r = await client.callTool({ name, arguments: args }, undefined, { signal: opts.signal, timeout: timeoutMs, resetTimeoutOnProgress: true });
        return { content: (Array.isArray(r.content) ? r.content : []) as Array<Record<string, unknown>>, structured: r.structuredContent, isError: r.isError === true };
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (err instanceof ToolError) throw err;
        throw new ToolError(`MCP aracı çalışmadı: ${describe(err)}`);
      }
    },
    opts,
  );
}
