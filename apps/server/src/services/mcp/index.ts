import type {
  McpApprovalDTO,
  McpApprovalMeta,
  McpAuthKind,
  McpPreset,
  McpScope,
  McpServerDTO,
  McpToolDTO,
} from '@sixfinger/shared';
import { MCP_LIMITS, mcpPreset } from '@sixfinger/shared';
import { auth as sdkAuth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config.ts';
import { withTx, type Db } from '../../db/pool.ts';
import type { SecretBox } from '../../lib/secretbox.ts';
import type { AuthUser } from '../../lib/types.ts';
import { HttpError, badRequest, forbidden, notFound } from '../../lib/errors.ts';
import { parseSafeUrl } from '../tools/net.ts';
import { ToolError } from '../tools/errors.ts';
import type { ToolDef, ToolResult } from '../tools/types.ts';
import { callMcpTool, listMcpTools, McpAuthRequired, type McpEndpoint, type McpRemoteTool } from './client.ts';
import { createGuardedFetch, type FetchLike } from './guarded-fetch.ts';
import { createOAuthProvider, type McpOAuthProvider, type OAuthState } from './oauth.ts';
import { describeTool, hashArgs, mcpToolName, renderResult, sanitizeSchema, wrapUntrusted } from './tools.ts';

export interface McpDeps {
  db: Db;
  secrets: SecretBox | null;
  config: Config;
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
  /** Testlerde korumasız fetch enjekte edilir; üretimde SSRF korumalı fetch kullanılır. */
  fetchImpl?: FetchLike;
}

interface Row {
  id: string;
  user_id: string;
  name: string;
  label: string;
  url: string;
  preset: string | null;
  auth_kind: McpAuthKind;
  auth_enc: string;
  header_names: string[];
  enabled: boolean;
  scopes: McpScope[];
  auto_approve: boolean;
  allow_tools: string[];
  tools: McpRemoteTool[];
  tools_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

interface AuthBlob {
  headers?: Record<string, string>;
  oauth?: OAuthState;
}

export interface CreateServerInput {
  label: string;
  url: string;
  preset?: string;
  headers?: Record<string, string>;
  scopes?: McpScope[];
}

export interface UpdateServerInput {
  label?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scopes?: McpScope[];
  autoApprove?: boolean;
  allowTools?: string[];
}

/** Bir turda modele verilecek MCP araçları ve istem için özet. */
export interface McpToolset {
  defs: ToolDef[];
  servers: Array<{ name: string; label: string; tools: number }>;
  /** Sınır yüzünden modele verilmeyen araç sayısı. */
  hidden: number;
  /** Onay istemeyen (salt okunur ya da izinli) araçların adları: alt ajanlar yalnızca bunları görür. */
  safeNames: Set<string>;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'mcp';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 240);

/** MCP bağlayıcıları: sunucu kayıtları, araç önbelleği, OAuth, araç adaptörü ve onaylar. */
export function createMcp(deps: McpDeps) {
  const { db, secrets, config, log } = deps;
  const fetchImpl = deps.fetchImpl ?? createGuardedFetch();
  const enabled = Boolean(secrets) && config.MCP_ENABLED !== 'false';
  const redirectUrl = `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/mcp/oauth/callback`;

  const need = (): SecretBox => {
    if (!enabled || !secrets) throw new HttpError(503, 'upstream_unavailable', 'Bağlayıcılar bu sunucuda ayarlanmamış (CODE_SECRET_KEY gerekir).');
    return secrets;
  };

  // ---------------------------------------------------------------- yönetici istemcileri (static OAuth)
  const staticClient = (provider: 'google' | 'slack' | 'hubspot' | undefined): { id: string; secret: string } | undefined => {
    const c = config;
    const pick = {
      google: [c.MCP_GOOGLE_CLIENT_ID, c.MCP_GOOGLE_CLIENT_SECRET],
      slack: [c.MCP_SLACK_CLIENT_ID, c.MCP_SLACK_CLIENT_SECRET],
      hubspot: [c.MCP_HUBSPOT_CLIENT_ID, c.MCP_HUBSPOT_CLIENT_SECRET],
    } as const;
    if (!provider) return undefined;
    const [id, secret] = pick[provider];
    return id && secret ? { id, secret } : undefined;
  };

  /** Kart bağlanabilir mi? static OAuth kartları yönetici istemcisi yoksa pasiftir (HubSpot: dinamik kayıt denenir). */
  function presetAvailable(p: McpPreset): { available: boolean; reason: 'soon' | 'admin' | null } {
    if (p.status === 'soon' || p.auth === 'soon') return { available: false, reason: 'soon' };
    if (p.auth === 'static' && p.provider !== 'hubspot' && !staticClient(p.provider)) return { available: false, reason: 'admin' };
    return { available: true, reason: null };
  }

  // ---------------------------------------------------------------- saklama
  const open = (row: Row): AuthBlob => {
    if (!row.auth_enc) return {};
    const plain = need().open(row.auth_enc);
    if (!plain) return {};
    try {
      return JSON.parse(plain) as AuthBlob;
    } catch {
      return {};
    }
  };
  const seal = (blob: AuthBlob): string => (blob.headers && Object.keys(blob.headers).length) || blob.oauth ? need().seal(JSON.stringify(blob)) : '';

  async function getRow(userId: string, id: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('Bağlayıcı bulunamadı.');
    const r = await db.query<Row>('select * from mcp_servers where id = $1 and user_id = $2', [id, userId]);
    if (!r.rows[0]) throw notFound('Bağlayıcı bulunamadı.');
    return r.rows[0];
  }

  /** Auth blob'unu kilitleyip günceller (jeton yenilemesi ile eşzamanlı yazımlar kaybolmasın). */
  async function patchAuth(id: string, fn: (b: AuthBlob) => AuthBlob): Promise<void> {
    await withTx(db, async (c) => {
      const r = await c.query<Row>('select * from mcp_servers where id = $1 for update', [id]);
      if (!r.rows[0]) return;
      const next = fn(open(r.rows[0]));
      await c.query('update mcp_servers set auth_enc = $2, updated_at = now() where id = $1', [id, seal(next)]);
    });
  }

  function toolDtos(row: Row): McpToolDTO[] {
    return (row.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description.slice(0, 300),
      readOnly: t.readOnly,
      allowed: row.auto_approve || row.allow_tools.includes(t.name),
    }));
  }

  function toDTO(row: Row): McpServerDTO {
    const blob = open(row);
    const connected = row.auth_kind === 'oauth' ? Boolean(blob.oauth?.tokens) : row.auth_kind === 'headers' ? row.header_names.length > 0 : true;
    return {
      id: row.id,
      name: row.name,
      label: row.label,
      url: row.url,
      preset: row.preset,
      authKind: row.auth_kind,
      headerNames: row.header_names,
      connected,
      enabled: row.enabled,
      scopes: row.scopes,
      autoApprove: row.auto_approve,
      allowTools: row.allow_tools,
      tools: toolDtos(row),
      toolsAt: row.tools_at ? row.tools_at.toISOString() : null,
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
    };
  }

  // ---------------------------------------------------------------- OAuth sağlayıcısı
  function providerFor(row: Row, extra: { state?: string } = {}): McpOAuthProvider {
    const preset = mcpPreset(row.preset);
    return createOAuthProvider({
      redirectUrl,
      state: extra.state,
      scopes: preset?.scopes,
      google: preset?.provider === 'google',
      staticClient: staticClient(preset?.provider),
      async load() {
        const r = await db.query<Row>('select * from mcp_servers where id = $1', [row.id]);
        return r.rows[0] ? (open(r.rows[0]).oauth ?? {}) : {};
      },
      async save(patch) {
        await patchAuth(row.id, (b) => {
          const oauth: OAuthState = { ...(b.oauth ?? {}) };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete (oauth as Record<string, unknown>)[k];
            else (oauth as Record<string, unknown>)[k] = v;
          }
          return { ...b, oauth };
        });
      },
    });
  }

  function endpointOf(row: Row): McpEndpoint {
    const blob = open(row);
    return {
      url: row.url,
      headers: blob.headers ?? {},
      authProvider: row.auth_kind === 'oauth' ? providerFor(row) : undefined,
      fetchImpl,
    };
  }

  // ---------------------------------------------------------------- CRUD
  async function list(userId: string): Promise<McpServerDTO[]> {
    const r = await db.query<Row>('select * from mcp_servers where user_id = $1 order by created_at', [userId]);
    return r.rows.map(toDTO);
  }

  const checkUrl = (url: string): string => {
    let u: URL;
    try {
      // Enjekte edilmiş fetch (yalnızca testler) kendi korumasını üstlenir; üretimde adres SSRF denetiminden geçer.
      if (deps.fetchImpl) return new URL(url).toString();
      u = parseSafeUrl(url);
    } catch (err) {
      throw badRequest(err instanceof ToolError ? err.message : 'Geçersiz adres.');
    }
    if (u.protocol !== 'https:') throw badRequest('MCP sunucuları yalnızca https üzerinden bağlanabilir.');
    return u.toString();
  };

  async function uniqueName(userId: string, label: string): Promise<string> {
    const base = slug(label);
    const taken = new Set((await db.query<{ name: string }>('select name from mcp_servers where user_id = $1', [userId])).rows.map((r) => r.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 22)}-${i}`;
    return name;
  }

  async function create(user: AuthUser, input: CreateServerInput): Promise<McpServerDTO> {
    need();
    if (user.isGuest) throw forbidden('Bağlayıcılar için hesap oluşturman gerekir.');
    const count = (await db.query<{ n: number }>('select count(*)::int as n from mcp_servers where user_id = $1', [user.id])).rows[0]!.n;
    if (count >= MCP_LIMITS.servers) throw badRequest(`En fazla ${MCP_LIMITS.servers} bağlayıcı ekleyebilirsin.`);
    const preset = mcpPreset(input.preset);
    if (input.preset && !preset) throw badRequest('Bilinmeyen hazır bağlayıcı.');
    if (preset) {
      const a = presetAvailable(preset);
      if (!a.available) throw badRequest(a.reason === 'admin' ? 'Bu bağlayıcı için sunucu yöneticisinin OAuth kaydı gerekiyor.' : 'Bu bağlayıcı henüz kullanılamıyor.');
    }
    const url = checkUrl(input.url);
    const headers = input.headers && Object.keys(input.headers).length ? input.headers : undefined;
    const authKind: McpAuthKind = headers ? 'headers' : preset && (preset.auth === 'dcr' || preset.auth === 'static') ? 'oauth' : 'none';
    const name = await uniqueName(user.id, input.label);
    const r = await db.query<Row>(
      `insert into mcp_servers (user_id, name, label, url, preset, auth_kind, auth_enc, header_names, scopes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [user.id, name, input.label, url, input.preset ?? null, authKind, seal({ headers }), headers ? Object.keys(headers) : [], input.scopes ?? ['chat', 'code']],
    );
    // OAuth'lu sunucuda yetki olmadan bağlanmayı denemek anlamsız: kullanıcı "Bağlan" der.
    if (authKind === 'oauth') return toDTO(r.rows[0]!);
    return refresh(user.id, r.rows[0]!.id);
  }

  async function update(userId: string, id: string, patch: UpdateServerInput): Promise<McpServerDTO> {
    need();
    const row = await getRow(userId, id);
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    let reconnect = false;
    if (patch.label !== undefined) add('label', patch.label);
    if (patch.url !== undefined && patch.url !== row.url) {
      add('url', checkUrl(patch.url));
      reconnect = true;
      // Adres değişince eski OAuth jetonları geçersizdir.
      if (row.auth_kind === 'oauth') await patchAuth(id, (b) => ({ ...b, oauth: undefined }));
    }
    if (patch.headers !== undefined) {
      const hasAny = Object.keys(patch.headers).length > 0;
      const blob = open(row);
      add('auth_enc', seal({ ...blob, headers: hasAny ? patch.headers : undefined }));
      add('header_names', Object.keys(patch.headers));
      if (hasAny) add('auth_kind', 'headers');
      else if (row.auth_kind === 'headers') add('auth_kind', 'none');
      reconnect = true;
    }
    if (patch.enabled !== undefined) add('enabled', patch.enabled);
    if (patch.scopes !== undefined) add('scopes', patch.scopes);
    if (patch.autoApprove !== undefined) add('auto_approve', patch.autoApprove);
    if (patch.allowTools !== undefined) add('allow_tools', patch.allowTools);
    if (sets.length) await db.query(`update mcp_servers set ${sets.join(', ')}, updated_at = now() where id = $1`, vals);
    if (reconnect) return refresh(userId, id);
    return toDTO(await getRow(userId, id));
  }

  async function remove(userId: string, id: string): Promise<void> {
    const r = await db.query('delete from mcp_servers where id = $1 and user_id = $2', [id, userId]);
    if (!r.rowCount) throw notFound('Bağlayıcı bulunamadı.');
  }

  /** Sunucuya bağlanıp araç listesini önbelleğe alır; hata `last_error`'a yazılır (ekleme başarısız olsa da kayıt kalır). */
  async function refresh(userId: string, id: string, signal?: AbortSignal): Promise<McpServerDTO> {
    need();
    const row = await getRow(userId, id);
    try {
      const tools = await listMcpTools(endpointOf(row), MCP_LIMITS.tools, { signal });
      await db.query('update mcp_servers set tools = $2, tools_at = now(), last_error = null, updated_at = now() where id = $1', [id, JSON.stringify(tools)]);
    } catch (err) {
      if (signal?.aborted) throw err;
      const code = err instanceof McpAuthRequired || err instanceof UnauthorizedError ? 'authorization_required' : errText(err);
      if (code === 'authorization_required' && row.auth_kind !== 'oauth') await db.query("update mcp_servers set auth_kind = 'oauth' where id = $1 and auth_kind = 'none'", [id]);
      await db.query('update mcp_servers set last_error = $2, updated_at = now() where id = $1', [id, code]);
      log.warn({ server: row.name, err: errText(err) }, 'MCP araç listesi alınamadı');
    }
    return toDTO(await getRow(userId, id));
  }

  // ---------------------------------------------------------------- OAuth akışı
  interface OAuthStateClaims extends Record<string, unknown> {
    u: string;
    s: string;
    t: 'web' | 'app';
    k: 'mcp';
  }

  /** Yetkilendirmeyi başlatır: tarayıcıda açılacak adresi döndürür (zaten yetkiliyse null). */
  async function startOAuth(userId: string, id: string, target: 'web' | 'app'): Promise<{ authorizeUrl: string | null; server: McpServerDTO }> {
    const box = need();
    const row = await getRow(userId, id);
    const preset = mcpPreset(row.preset);
    if (preset) {
      const a = presetAvailable(preset);
      if (!a.available) throw badRequest('Bu bağlayıcı için sunucu yöneticisinin OAuth kaydı gerekiyor.');
    }
    if (row.auth_kind === 'headers') throw badRequest('Bu bağlayıcı anahtarla bağlanıyor; önce başlıkları kaldır.');
    if (row.auth_kind !== 'oauth') await db.query("update mcp_servers set auth_kind = 'oauth' where id = $1", [id]);
    const state = box.signState({ u: userId, s: id, t: target, k: 'mcp' } satisfies OAuthStateClaims, 600);
    const provider = providerFor(row, { state });
    // Önceki yarım kalmış akıştan kalan doğrulayıcıyı temizle.
    await provider.saveCodeVerifier('');
    let result: 'AUTHORIZED' | 'REDIRECT';
    try {
      result = await sdkAuth(provider, { serverUrl: row.url, scope: preset?.scopes?.join(' '), fetchFn: fetchImpl });
    } catch (err) {
      const msg = errText(err);
      await db.query('update mcp_servers set last_error = $2 where id = $1', [id, msg]);
      throw badRequest(`Yetkilendirme başlatılamadı: ${msg}`);
    }
    if (result === 'AUTHORIZED') return { authorizeUrl: null, server: await refresh(userId, id) };
    if (!provider.authorizationUrl) throw badRequest('Yetkilendirme adresi alınamadı.');
    return { authorizeUrl: provider.authorizationUrl.toString(), server: toDTO(await getRow(userId, id)) };
  }

  /** Geri dönüşün imzalı `state`'ini çözer (callback herkese açık olduğu için yalnızca hedefi öğrenmek için). */
  function peekState(state: string): { target: 'web' | 'app' } | null {
    const st = secrets?.verifyState<OAuthStateClaims>(state);
    return st && st.k === 'mcp' ? { target: st.t === 'app' ? 'app' : 'web' } : null;
  }

  /** Kod değişimi: state'i başlatan kullanıcı ile isteği yapan oturum aynı olmalı. */
  async function completeOAuth(userId: string, code: string, state: string): Promise<McpServerDTO> {
    const box = need();
    const st = box.verifyState<OAuthStateClaims>(state);
    if (!st || st.k !== 'mcp' || st.u !== userId) throw badRequest('Yetkilendirme isteği geçersiz ya da süresi dolmuş. Tekrar dene.');
    const row = await getRow(userId, st.s);
    const preset = mcpPreset(row.preset);
    const provider = providerFor(row);
    try {
      await sdkAuth(provider, { serverUrl: row.url, authorizationCode: code, scope: preset?.scopes?.join(' '), fetchFn: fetchImpl });
    } catch (err) {
      const msg = errText(err);
      await db.query('update mcp_servers set last_error = $2 where id = $1', [row.id, msg]);
      throw badRequest(`Yetkilendirme tamamlanamadı: ${msg}`);
    }
    await provider.saveCodeVerifier('');
    return refresh(userId, row.id);
  }

  async function disconnect(userId: string, id: string): Promise<McpServerDTO> {
    const row = await getRow(userId, id);
    await patchAuth(id, (b) => ({ ...b, oauth: undefined }));
    await db.query("update mcp_servers set tools = '[]', tools_at = null, last_error = $2 where id = $1", [id, row.auth_kind === 'oauth' ? 'authorization_required' : null]);
    return toDTO(await getRow(userId, id));
  }

  // ---------------------------------------------------------------- onaylar
  async function requestApproval(userId: string, chatId: string, serverId: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const hash = hashArgs(args);
    const dup = await db.query<{ id: string }>(
      `select id from mcp_approvals where user_id = $1 and chat_id = $2 and server_id = $3 and tool = $4 and args_hash = $5 and status = 'pending'
          and created_at > now() - ($6 || ' minutes')::interval order by created_at desc limit 1`,
      [userId, chatId, serverId, tool, hash, String(MCP_LIMITS.approvalMinutes)],
    );
    if (dup.rows[0]) return dup.rows[0].id;
    const r = await db.query<{ id: string }>(
      'insert into mcp_approvals (user_id, chat_id, server_id, tool, args_hash, args) values ($1, $2, $3, $4, $5, $6) returning id',
      [userId, chatId, serverId, tool, hash, JSON.stringify(args)],
    );
    return r.rows[0]!.id;
  }

  /** Onaylanmış (ve henüz kullanılmamış) aynı çağrı varsa tek seferlik tüketir. */
  async function consumeApproval(userId: string, chatId: string, serverId: string, tool: string, args: Record<string, unknown>): Promise<boolean> {
    const r = await db.query(
      `update mcp_approvals set status = 'used' where id = (
         select id from mcp_approvals where user_id = $1 and chat_id = $2 and server_id = $3 and tool = $4 and args_hash = $5 and status = 'approved'
            and decided_at > now() - ($6 || ' minutes')::interval order by decided_at desc limit 1 for update skip locked)`,
      [userId, chatId, serverId, tool, hashArgs(args), String(MCP_LIMITS.approvalMinutes)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async function getApproval(userId: string, id: string): Promise<McpApprovalDTO> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('Onay bulunamadı.');
    const r = await db.query<{ id: string; chat_id: string; server_id: string; tool: string; args: Record<string, unknown>; status: McpApprovalDTO['status']; created_at: Date; label: string }>(
      `select a.id, a.chat_id, a.server_id, a.tool, a.args, a.status, a.created_at, s.label
         from mcp_approvals a join mcp_servers s on s.id = a.server_id where a.id = $1 and a.user_id = $2`,
      [id, userId],
    );
    const a = r.rows[0];
    if (!a) throw notFound('Onay bulunamadı.');
    return { id: a.id, chatId: a.chat_id, serverId: a.server_id, server: a.label, tool: a.tool, args: a.args, status: a.status, createdAt: a.created_at.toISOString() };
  }

  /** Kullanıcının kararı: once → bu çağrı için onay; always → aracı kalıcı izinli yap; deny → reddet. */
  async function decideApproval(userId: string, id: string, decision: 'once' | 'always' | 'deny'): Promise<McpApprovalDTO> {
    const cur = await getApproval(userId, id);
    if (cur.status !== 'pending') throw badRequest('Bu onay zaten yanıtlanmış.');
    const status = decision === 'deny' ? 'denied' : 'approved';
    const r = await db.query(
      `update mcp_approvals set status = $3, decided_at = now() where id = $1 and user_id = $2 and status = 'pending'
          and created_at > now() - ($4 || ' minutes')::interval`,
      [id, userId, status, String(MCP_LIMITS.approvalMinutes)],
    );
    if (!r.rowCount) throw badRequest('Bu onayın süresi dolmuş. Aracı yeniden istemesini söyle.');
    if (decision === 'always') {
      await db.query('update mcp_servers set allow_tools = array_append(allow_tools, $3), updated_at = now() where id = $1 and user_id = $2 and not ($3 = any(allow_tools))', [cur.serverId, userId, cur.tool]);
    }
    return getApproval(userId, id);
  }

  // ---------------------------------------------------------------- araçlar
  /**
   * Kullanıcının bu kapsam (chat/code) için etkin sunucularının araçları. Araç listesi veritabanı önbelleğinden gelir (ağ yok).
   * `readOnly` araçlar otomatik çalışır; diğerleri `auto_approve`/`allow_tools` yoksa kullanıcı onayı ister (tur biter).
   */
  async function toolsFor(userId: string, scope: McpScope, opts: { readOnlyOnly?: boolean } = {}): Promise<McpToolset> {
    if (!enabled) return { defs: [], servers: [], hidden: 0, safeNames: new Set() };
    const r = await db.query<Row>(`select * from mcp_servers where user_id = $1 and enabled and $2 = any(scopes) and jsonb_array_length(tools) > 0 order by created_at`, [userId, scope]);
    const used = new Set<string>();
    const all: ToolDef[] = [];
    const servers: McpToolset['servers'] = [];
    const safe = new Set<string>();
    for (const row of r.rows) {
      let n = 0;
      for (const t of row.tools) {
        if (opts.readOnlyOnly && !t.readOnly) continue;
        const name = mcpToolName(row.name, t.name, used);
        all.push(makeTool(row, t, name));
        if (t.readOnly || row.auto_approve || row.allow_tools.includes(t.name)) safe.add(name);
        n++;
      }
      if (n) servers.push({ name: row.name, label: row.label, tools: n });
    }
    const defs = all.slice(0, MCP_LIMITS.modelTools);
    return { defs, servers, hidden: all.length - defs.length, safeNames: safe };
  }

  function makeTool(row: Row, t: McpRemoteTool, name: string): ToolDef {
    return {
      name,
      description: describeTool(row.label, t.description || t.name, t.readOnly),
      parameters: sanitizeSchema(t.inputSchema),
      maxOutputChars: 12_000,
      available: () => true,
      async run(raw, ctx): Promise<ToolResult> {
        const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
        // Satır, çağrı sırasında silinmiş ya da devre dışı bırakılmış olabilir: taze oku.
        const fresh = await db.query<Row>('select * from mcp_servers where id = $1 and user_id = $2', [row.id, ctx.user.id]);
        const cur = fresh.rows[0];
        if (!cur || !cur.enabled) throw new ToolError('Bu bağlayıcı kapatılmış ya da silinmiş.');
        const trusted = t.readOnly || cur.auto_approve || cur.allow_tools.includes(t.name);
        if (!trusted) {
          if (!ctx.chatId) throw new ToolError('Bu araç kullanıcı onayı gerektirir ve burada onay istenemez.');
          if (!(await consumeApproval(ctx.user.id, ctx.chatId, cur.id, t.name, args))) {
            const id = await requestApproval(ctx.user.id, ctx.chatId, cur.id, t.name, args);
            const approval: McpApprovalMeta = { id, server: cur.label, tool: t.name, args };
            return {
              output:
                `ONAY GEREKİYOR: "${t.name}" (${cur.label}) veriyi değiştirebilir; kullanıcıya onay kartı gösterildi. Şimdi DUR ve kullanıcının kararını bekle. ` +
                'Onaylarsa aynı aracı aynı argümanlarla tekrar çağır; reddederse yapma ve alternatif öner.',
              summary: 'Onay bekliyor',
              meta: { terminal: true, approval },
            };
          }
        }
        const res = await callMcpTool(
          { url: cur.url, headers: open(cur).headers ?? {}, authProvider: cur.auth_kind === 'oauth' ? providerFor(cur) : undefined, fetchImpl },
          t.name,
          args,
          MCP_LIMITS.callSeconds * 1000,
          { signal: ctx.signal },
        ).catch((err) => {
          if (err instanceof McpAuthRequired) throw new ToolError(`${cur.label} için yetkilendirme gerekiyor; kullanıcıdan Bağlayıcılar sayfasında yeniden bağlanmasını iste.`);
          throw err;
        });
        const text = wrapUntrusted(cur.label, t.name, renderResult(res));
        if (res.isError) throw new ToolError(text.slice(0, 2_000));
        return { output: text, summary: cur.label, meta: { server: cur.label, tool: t.name } };
      },
    };
  }

  return {
    enabled,
    redirectUrl,
    presetAvailable,
    list,
    create,
    update,
    remove,
    refresh,
    disconnect,
    startOAuth,
    completeOAuth,
    peekState,
    requestApproval,
    consumeApproval,
    getApproval,
    decideApproval,
    toolsFor,
    /** Bu kullanıcının sunucusu mu (başka kullanıcıya 404). */
    owns: async (userId: string, id: string) => {
      await getRow(userId, id);
    },
  };
}

export type Mcp = ReturnType<typeof createMcp>;
