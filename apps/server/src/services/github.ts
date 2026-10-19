import type { CodePullDTO, GithubBranchesDTO, GithubRepoDTO } from '@sixfinger/shared';
import type { Config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';

type FetchLike = typeof fetch;

export interface GithubUser {
  id: number;
  login: string;
  avatarUrl: string;
}

const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

/** GitHub OAuth + REST. Token'lar çağıran tarafından verilir; burada saklanmaz. */
export function createGithub(config: Config, fetchImpl: FetchLike = fetch) {
  const configured = Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);

  async function call(url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    const { token, ...rest } = init;
    return fetchImpl(url, {
      ...rest,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'SixFinger-Code',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async function json<T>(res: Response, what: string): Promise<T> {
    if (res.status === 401) {
      throw new HttpError(401, 'github_required', 'GitHub bağlantın geçersiz. Hesabını yeniden bağla.');
    }
    if (res.status === 403 || res.status === 429) {
      throw new HttpError(429, 'rate_limited', 'GitHub şu an istekleri sınırlıyor. Biraz sonra tekrar dene.');
    }
    if (res.status === 404) throw new HttpError(404, 'not_found', `${what} bulunamadı ya da erişimin yok.`);
    if (!res.ok) throw new HttpError(502, 'upstream_unavailable', `GitHub ${what} için ${res.status} döndürdü.`);
    return (await res.json()) as T;
  }

  const wrapNetwork = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'upstream_unavailable', 'GitHub\'a ulaşılamadı.');
    }
  };

  return {
    configured,

    authorizeUrl(state: string): string {
      const u = new URL('https://github.com/login/oauth/authorize');
      u.searchParams.set('client_id', config.GITHUB_CLIENT_ID);
      u.searchParams.set('redirect_uri', config.githubRedirectUrl);
      u.searchParams.set('scope', 'repo read:user');
      u.searchParams.set('state', state);
      u.searchParams.set('allow_signup', 'false');
      return u.toString();
    },

    async exchange(code: string): Promise<{ token: string; scope: string }> {
      return wrapNetwork(async () => {
        const res = await call('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_id: config.GITHUB_CLIENT_ID,
            client_secret: config.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: config.githubRedirectUrl,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string };
        if (!res.ok || !body.access_token) {
          throw new HttpError(400, 'bad_request', 'GitHub girişi tamamlanamadı. Tekrar dene.');
        }
        return { token: body.access_token, scope: body.scope ?? '' };
      });
    },

    async user(token: string): Promise<GithubUser> {
      return wrapNetwork(async () => {
        const u = await json<{ id: number; login: string; avatar_url?: string }>(await call(`${API}/user`, { token }), 'Hesap');
        return { id: u.id, login: u.login, avatarUrl: u.avatar_url ?? '' };
      });
    },

    /** Kullanıcının erişebildiği repolar (en son push edilenden başlayarak, en çok 300). */
    async repos(token: string): Promise<GithubRepoDTO[]> {
      return wrapNetwork(async () => {
        const out: GithubRepoDTO[] = [];
        for (let page = 1; page <= 3; page++) {
          const rows = await json<
            Array<{ full_name: string; private: boolean; default_branch: string; description: string | null; pushed_at: string | null; archived?: boolean }>
          >(
            await call(`${API}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, { token }),
            'Repolar',
          );
          for (const r of rows) {
            if (r.archived) continue;
            out.push({
              fullName: r.full_name,
              private: r.private,
              defaultBranch: r.default_branch,
              description: r.description ?? '',
              pushedAt: r.pushed_at,
            });
          }
          if (rows.length < 100) break;
        }
        return out;
      });
    },

    async branches(token: string, repo: string): Promise<GithubBranchesDTO> {
      return wrapNetwork(async () => {
        const info = await json<{ default_branch: string }>(await call(`${API}/repos/${repo}`, { token }), 'Repo');
        const names: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const rows = await json<Array<{ name: string }>>(
            await call(`${API}/repos/${repo}/branches?per_page=100&page=${page}`, { token }),
            'Branch listesi',
          );
          names.push(...rows.map((b) => b.name));
          if (rows.length < 100) break;
        }
        const ordered = [info.default_branch, ...names.filter((n) => n !== info.default_branch)];
        return { defaultBranch: info.default_branch, branches: ordered };
      });
    },

    /** Bir branch'ten açılmış pull request'ler (en yeni 5; ekleme/silme sayıları için tek tek okunur). */
    async pulls(token: string, repo: string, branch: string): Promise<CodePullDTO[]> {
      return wrapNetwork(async () => {
        const owner = repo.split('/')[0]!;
        const list = await json<Array<{ number: number }>>(
          await call(`${API}/repos/${repo}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`, { token }),
          'Pull request listesi',
        );
        const out: CodePullDTO[] = [];
        for (const p of list.slice(0, 5)) {
          const d = await json<{
            number: number; title: string; state: string; merged?: boolean; draft?: boolean; html_url: string;
            additions?: number; deletions?: number; changed_files?: number;
          }>(await call(`${API}/repos/${repo}/pulls/${p.number}`, { token }), 'Pull request');
          out.push({
            number: d.number,
            title: d.title,
            state: d.merged ? 'merged' : d.state === 'open' ? 'open' : 'closed',
            draft: Boolean(d.draft),
            url: d.html_url,
            additions: d.additions ?? 0,
            deletions: d.deletions ?? 0,
            changedFiles: d.changed_files ?? 0,
          });
        }
        return out;
      });
    },

    /** Bağlantıyı keserken GitHub tarafındaki yetkiyi de iptal etmeyi dener (başarısız olursa sessizce geçer). */
    async revoke(token: string): Promise<void> {
      try {
        await call(`${API}/applications/${config.GITHUB_CLIENT_ID}/grant`, {
          method: 'DELETE',
          headers: {
            authorization: `Basic ${Buffer.from(`${config.GITHUB_CLIENT_ID}:${config.GITHUB_CLIENT_SECRET}`).toString('base64')}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ access_token: token }),
        });
      } catch {
        /* en iyi çaba */
      }
    },
  };
}
export type Github = ReturnType<typeof createGithub>;
