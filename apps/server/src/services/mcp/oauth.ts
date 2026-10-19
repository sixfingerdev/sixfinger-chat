import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

/** Sunucuda şifreli saklanan OAuth durumu (sunucu başına). */
export interface OAuthState {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
}

export interface ProviderOptions {
  /** GitHub kalıbı: tarayıcı buraya döner (`/api/mcp/oauth/callback`). */
  redirectUrl: string;
  load(): Promise<OAuthState>;
  /** Verilen alanları mevcut durumla birleştirir (`undefined` değer alanı siler). */
  save(patch: Partial<Record<keyof OAuthState, OAuthState[keyof OAuthState] | undefined>>): Promise<void>;
  /** Sunucu yöneticisinin kayıtlı istemcisi (Google, Slack…): dinamik kayıt atlanır. */
  staticClient?: { id: string; secret: string };
  /** İmzalı `state` (yetkilendirmeyi başlatan kullanıcı + sunucu + hedef). */
  state?: string;
  scopes?: string[];
  /** Google: yenileme jetonu için `access_type=offline` + `prompt=consent`. */
  google?: boolean;
}

export type McpOAuthProvider = OAuthClientProvider & {
  /** `redirectToAuthorization` ile yakalanan yetkilendirme adresi. */
  authorizationUrl: URL | null;
};

/**
 * SDK `OAuthClientProvider` uygulaması: MCP yetkilendirme standardı (kaynak meta verisi keşfi, dinamik istemci kaydı ya da yönetici istemcisi,
 * PKCE, yenileme jetonu). Tarayıcıya yönlendirme yapılmaz; adres yakalanır ve istemciye döndürülür.
 */
export function createOAuthProvider(o: ProviderOptions): McpOAuthProvider {
  const provider: McpOAuthProvider = {
    authorizationUrl: null,
    get redirectUrl() {
      return o.redirectUrl;
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: 'SixFinger',
        redirect_uris: [o.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: o.staticClient?.secret ? 'client_secret_post' : 'none',
        ...(o.scopes?.length ? { scope: o.scopes.join(' ') } : {}),
      };
    },
    state: o.state ? () => o.state! : undefined,
    async clientInformation() {
      if (o.staticClient) return { client_id: o.staticClient.id, ...(o.staticClient.secret ? { client_secret: o.staticClient.secret } : {}) };
      return (await o.load()).client;
    },
    async saveClientInformation(info) {
      if (!o.staticClient) await o.save({ client: info });
    },
    async tokens() {
      return (await o.load()).tokens;
    },
    async saveTokens(tokens) {
      await o.save({ tokens });
    },
    async redirectToAuthorization(url) {
      if (o.google) {
        url.searchParams.set('access_type', 'offline');
        url.searchParams.set('prompt', 'consent');
      }
      provider.authorizationUrl = url;
    },
    async saveCodeVerifier(verifier) {
      await o.save({ verifier });
    },
    async codeVerifier() {
      const v = (await o.load()).verifier;
      if (!v) throw new Error('Yetkilendirme isteği bulunamadı ya da süresi doldu.');
      return v;
    },
    async saveDiscoveryState(discovery) {
      await o.save({ discovery });
    },
    async discoveryState() {
      return (await o.load()).discovery;
    },
    async invalidateCredentials(scope) {
      if (scope === 'all') await o.save({ client: o.staticClient ? undefined : undefined, tokens: undefined, verifier: undefined, discovery: undefined });
      else if (scope === 'client') await o.save({ client: undefined });
      else if (scope === 'tokens') await o.save({ tokens: undefined });
      else if (scope === 'verifier') await o.save({ verifier: undefined });
      else if (scope === 'discovery') await o.save({ discovery: undefined });
    },
  };
  return provider;
}
