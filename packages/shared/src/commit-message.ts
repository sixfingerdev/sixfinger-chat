/**
 * SixFinger Code'un attığı commit'lerin ve PR'ların atıf satırları. Commit yazarı kullanıcının kendisidir; ajan HER ZAMAN ortak yazar
 * olarak eklenir (kapatılamaz). Yalnızca oturum bağlantısı satırı kullanıcının seçimine bağlıdır.
 */
export const CODE_COAUTHOR = 'SixFinger Code <noreply@sixfinger.live>';

export interface CommitAttribution {
  /** Oturum bağlantısı satırı (özel bir adres; ortam ayarında açılırsa verilir). */
  sessionUrl?: string | null;
}

const noNul = (s: string) => s.split(String.fromCharCode(0)).join('');
const oneLine = (s: string) => noNul(s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Commit başlığı: tek satır, en çok 72 karakter, sonda nokta yok. */
export function commitSubject(raw: string, fallback = 'SixFinger Code değişiklikleri'): string {
  let s = oneLine(raw).replace(/^["'`]+|["'`]+$/g, '').replace(/[.。]+$/, '');
  if (!s) s = fallback;
  if (s.length > 72) s = `${s.slice(0, 71).trimEnd()}…`;
  return s;
}

/** Başlık + (varsa) gövde + atıf satırları. Aynı satır iki kez eklenmez. */
export function buildCommitMessage(subject: string, body: string | undefined, attr: CommitAttribution = {}): string {
  const trailers: string[] = [`Co-Authored-By: ${CODE_COAUTHOR}`];
  if (attr.sessionUrl) trailers.push(`SixFinger-Session: ${oneLine(attr.sessionUrl)}`);
  const cleanBody = noNul(body ?? '')
    .split('\n')
    .filter((l) => !/^(co-authored-by|sixfinger-session):/i.test(l.trim()))
    .join('\n')
    .trim();
  return [commitSubject(subject), cleanBody, trailers.join('\n')].filter(Boolean).join('\n\n');
}

/** PR açıklamasının sonuna eklenen atıf. */
export function prFooter(attr: CommitAttribution = {}): string {
  return `Generated with SixFinger Code${attr.sessionUrl ? `\n\n${oneLine(attr.sessionUrl)}` : ''}`;
}

/** GitHub'ın e-posta gizleme adresi: `<id>+<login>@users.noreply.github.com`. */
export function githubNoreply(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}
