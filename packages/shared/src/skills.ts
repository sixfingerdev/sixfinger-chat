/**
 * Skill'ler (Agent Skills biçimi): `<ad>/SKILL.md` = YAML başlık (`name`, `description`) + Markdown gövde. Katalog (ad + açıklama) her
 * turda ajanın istemine girer, gövde ve ek dosyalar yalnızca `skill` aracıyla istenince yüklenir (küçük bağlam için kademeli yükleme).
 * Bu dosya çözümleyici, doğrulama ve eşleştirmeyi içerir (sunucu, web ve mobil ortak).
 */

export type SkillSource = 'builtin' | 'user' | 'repo';

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_LIMITS = {
  name: 64,
  description: 1024,
  /** SKILL.md gövdesi (~5 bin token). */
  body: 20_000,
  /** Ek dosya başına ve skill başına dosya sayısı. */
  file: 50_000,
  files: 20,
  /** Kullanıcı başına skill sayısı. */
  perUser: 50,
  /** Repodan keşfedilen skill sayısı. */
  repo: 30,
  triggers: 30,
} as const;

/** Modele giden katalog satırı ve arayüz listesi. */
export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
  /** Eşleştirme ipucu için anahtar sözcükler (Türkçe + İngilizce). */
  triggers: string[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  triggers: string[];
  license?: string;
  body: string;
  /** Bilinmeyen başlık alanları (kullanılmaz; yetki vermez). */
  extra: Record<string, string>;
}

const unquote = (v: string): string => {
  const s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
};

const inlineList = (v: string): string[] =>
  v
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((x) => unquote(x))
    .filter(Boolean);

/** Küçük bir YAML alt kümesi: `anahtar: değer`, tırnaklı değer, `>`/`|` blokları, `[a, b]` ve `- madde` listeleri. */
export function parseFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } | null {
  const src = text.replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return null;
  const lines = m[1]!.split('\n');
  const data: Record<string, string | string[]> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const rest = kv[2]!.trim();
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1]!.startsWith(' ') || lines[i + 1]!.startsWith('\t') || !lines[i + 1]!.trim())) block.push(lines[++i]!.trim());
      data[key] = rest.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (rest === '') {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) items.push(unquote(lines[++i]!.replace(/^\s*-\s+/, '')));
      data[key] = items;
    } else if (rest.startsWith('[')) data[key] = inlineList(rest);
    else data[key] = unquote(rest);
  }
  return { data, body: src.slice(m[0].length).replace(/^\n+/, '') };
}

export type SkillParse = { ok: true; skill: ParsedSkill } | { ok: false; error: string };

/** SKILL.md metnini çözümler ve doğrular. `fallbackName`: başlıkta ad yoksa klasör adı. */
export function parseSkillMd(text: string, fallbackName?: string): SkillParse {
  const fm = parseFrontmatter(text);
  if (!fm) return { ok: false, error: 'SKILL.md bir YAML başlığıyla (--- name, description ---) başlamalı.' };
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(' ') : (v ?? '')).trim();
  const name = (str(fm.data.name) || fallbackName || '').toLowerCase();
  if (!name) return { ok: false, error: 'Skill adı (name) gerekli.' };
  if (name.length > SKILL_LIMITS.name || !SKILL_NAME_RE.test(name)) return { ok: false, error: 'Skill adı yalnızca küçük harf, rakam ve tire içerebilir (en çok 64 karakter).' };
  const description = str(fm.data.description);
  if (!description) return { ok: false, error: 'Açıklama (description) gerekli: skill\'in ne yaptığını ve ne zaman kullanılacağını yaz.' };
  if (description.length > SKILL_LIMITS.description) return { ok: false, error: `Açıklama en çok ${SKILL_LIMITS.description} karakter olabilir.` };
  const body = fm.body.trim();
  if (!body) return { ok: false, error: 'Skill gövdesi boş.' };
  if (body.length > SKILL_LIMITS.body) return { ok: false, error: `Skill gövdesi en çok ${SKILL_LIMITS.body} karakter olabilir; ayrıntıları references/ altındaki dosyalara taşı.` };
  const trig = fm.data.triggers ?? fm.data.keywords;
  const triggers = (Array.isArray(trig) ? trig : trig ? inlineList(trig) : []).map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, SKILL_LIMITS.triggers);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(fm.data)) if (!['name', 'description', 'triggers', 'keywords', 'license'].includes(k)) extra[k] = str(v);
  return { ok: true, skill: { name, description, triggers, license: str(fm.data.license) || undefined, body, extra } };
}

/** Düzenleyici için: alanlardan SKILL.md üretir. */
export function serializeSkillMd(s: { name: string; description: string; triggers?: string[]; body: string }): string {
  const q = (v: string) => (/[:#\n"']/.test(v) ? `"${v.replace(/"/g, '\\"').replace(/\n/g, ' ')}"` : v);
  const trig = s.triggers?.length ? `triggers: [${s.triggers.map(q).join(', ')}]\n` : '';
  return `---\nname: ${s.name}\ndescription: ${q(s.description)}\n${trig}---\n\n${s.body.trim()}\n`;
}

/** Skill dosya yolu güvenli mi (klasör dışına çıkmaz, gizli/mutlak değil)? */
export function safeSkillPath(p: string): boolean {
  return p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && !p.split('/').some((s) => s === '..' || s === '' || s === '.');
}

// ------------------------------------------------------------------------------------------------ eşleştirme

const STOP = new Set(
  ('the a an and or for with that this from into your you are can use using when how what make build create write need want please yap yapmak bir ve ile icin ben bana benim bu su ' +
    'olan olarak gibi daha cok var yok mi mu misin musun lutfen istiyorum istedigim').split(' '),
);

const fold = (s: string): string => s.toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/İ/g, 'i');

/** Sözcük kökü: Türkçe/İngilizce ekleri kabaca yutmak için ilk 4 harf. */
const stem = (w: string): string => w.slice(0, 4);

function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Kullanıcı mesajına en uygun skill'ler. Küçük modelin kataloğu atlamasına karşı sunucu tarafı ipucu: `triggers` ve açıklama sözcükleri
 * (kök eşleşmesi, ağırlık: nadir sözcük daha değerli; tetikleyici sözcük ve ad açıklamadan daha değerli).
 */
export function matchSkills(catalog: SkillSummary[], text: string, max = 2): SkillSummary[] {
  const q = [...new Set(tokens(text).map(stem))];
  if (!q.length || !catalog.length) return [];
  const docs = catalog.map((s) => ({
    s,
    trig: new Set(s.triggers.flatMap((t) => tokens(t)).map(stem)),
    name: new Set(tokens(s.name.replace(/-/g, ' ')).map(stem)),
    desc: new Set(tokens(s.description).map(stem)),
  }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set([...d.trig, ...d.name, ...d.desc])) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + docs.length / (df.get(w) ?? 1));
  const scored = docs.map((d) => {
    let score = 0;
    let strong = 0;
    for (const w of q) {
      if (d.trig.has(w)) {
        score += 3 * idf(w);
        strong++;
      } else if (d.name.has(w)) {
        score += 2 * idf(w);
        strong++;
      } else if (d.desc.has(w)) score += 1 * idf(w);
    }
    return { s: d.s, score, strong };
  });
  return scored
    .filter((x) => x.strong >= 1 && x.score >= 2.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

// ------------------------------------------------------------------------------------------------ DTO ve GitHub adresi

/** Skill listesi satırı (yerleşik + kullanıcı). */
export interface SkillListItemDTO {
  name: string;
  description: string;
  source: 'builtin' | 'user';
  triggers: string[];
  fileCount: number;
  /** Kullanıcı skill'i bir yerleşiğin üstüne yazıyor mu? */
  overrides?: boolean;
  /** Bağlantıyla paylaşılıyorsa token. */
  shareToken?: string | null;
  importedFrom?: string | null;
  updatedAt?: string;
}

export interface SkillDetailDTO extends SkillListItemDTO {
  /** Düzenleyici için tam SKILL.md metni. */
  markdown: string;
  body: string;
  files: Record<string, string>;
}

/** `https://github.com/o/r/tree/ref/dir`, `…/blob/ref/dir/SKILL.md`, `https://github.com/o/r` ya da `o/r/dir` → depo, ref, klasör yolu. */
export function parseGithubSkillUrl(input: string): { repo: string; ref?: string; path: string } | null {
  const s = input.trim().replace(/\.git$/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const url = /^https?:\/\/(?:www\.)?github\.com\/(.+)$/i.exec(s);
  const parts = (url ? url[1]! : s).split('/').filter(Boolean);
  if (parts.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_.-]+$/.test(parts[1]!)) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  const rest = parts.slice(2);
  if (rest[0] === 'tree' || rest[0] === 'blob') {
    const ref = rest[1];
    let path = rest.slice(2);
    if (rest[0] === 'blob' && path.at(-1)?.toLowerCase() === 'skill.md') path = path.slice(0, -1);
    return ref ? { repo, ref, path: path.join('/') } : null;
  }
  const path = rest.join('/');
  return path.split('/').some((p) => p === '..') ? null : { repo, path };
}
