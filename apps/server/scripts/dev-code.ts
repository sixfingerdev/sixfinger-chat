// Geliştirme: SixFinger Code'u gerçek GitHub olmadan denemek için sahte GitHub'lı sunucu.
//   npx tsx scripts/dev-code.ts      (ortam değişkenleri restart-api2.sh ile aynı; ayrıca CODE_* değişkenleri)
// "GitHub'a bağlan" tarayıcıyı doğrudan geri dönüş adresine yollar (izin ekranı atlanır).
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createGithub } from '../src/services/github.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REPOS = [
  { full_name: 'enes/sixfinger-chat', private: false, default_branch: 'main', description: 'SixFinger sohbet uygulaması', pushed_at: '2026-10-18T10:00:00Z' },
  { full_name: 'enes/valorant-web', private: true, default_branch: 'master', description: 'Tarayıcıda Valorant benzeri oyun', pushed_at: '2026-10-17T10:00:00Z' },
  { full_name: 'enes/zenith-havacilik', private: true, default_branch: 'main', description: 'Zenith Havacılık takım özeti', pushed_at: '2026-10-10T10:00:00Z' },
  { full_name: 'sixfingerdev/claudesproject', private: false, default_branch: 'main', description: '', pushed_at: '2026-10-05T10:00:00Z' },
];

const fake: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://github.com/login/oauth/access_token') return json({ access_token: 'gho_dev', scope: 'repo,read:user' });
  if (url === 'https://api.github.com/user') return json({ id: 1, login: 'enes', avatar_url: '' });
  if (url.startsWith('https://api.github.com/user/repos')) return json(REPOS);
  const info = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)$/);
  if (info) {
    const r = REPOS.find((x) => x.full_name === info[1]);
    return r ? json({ default_branch: r.default_branch }) : json({ message: 'Not Found' }, 404);
  }
  if (/\/branches/.test(url)) return json([{ name: 'main' }, { name: 'master' }, { name: 'feature/login' }, { name: 'fix/scroll' }]);
  if (init?.method === 'DELETE') return new Response(null, { status: 204 });
  return json({ message: 'Not Found' }, 404);
};

const config = loadConfig();
const gh = createGithub(config, fake);
const { app } = await buildApp({
  config,
  github: { ...gh, authorizeUrl: (state: string) => `${config.githubRedirectUrl}?code=dev&state=${encodeURIComponent(state)}` },
});
await app.listen({ port: config.PORT, host: config.HOST });
