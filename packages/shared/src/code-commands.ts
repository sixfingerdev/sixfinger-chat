/** Code oturumunun slash komutları, soru yanıtı metni ve @dosya yardımcıları (web ve mobil ortak). */

export type SlashKind = 'send' | 'plan' | 'pr' | 'compact';

export interface SlashCommand {
  name: string;
  kind: SlashKind;
  /** `send`: ajana gönderilecek istem. `$ARGUMENTS` komuttan sonra yazılanla değişir. */
  template?: string;
  /** Repodaki komut dosyasından geliyorsa açıklama. */
  description?: string;
  source: 'builtin' | 'repo';
}

/** Yerleşik komutlar (açıklama metinleri i18n'de: `code.slash.<ad>`). */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'plan', kind: 'plan', source: 'builtin' },
  { name: 'compact', kind: 'compact', source: 'builtin' },
  { name: 'pr', kind: 'pr', source: 'builtin' },
  {
    name: 'init',
    kind: 'send',
    source: 'builtin',
    template:
      'Analyze this repository and create (or, if it exists, improve) a SIXFINGER.md file at the repository root for future coding agents (if the repository already has an AGENTS.md or CLAUDE.md, use it as a source but still write SIXFINGER.md): what the project is, the directory layout, how to install, build, test and lint (the exact commands, verified by running the fast ones), code conventions you can see in the code, and pitfalls. Keep it under 120 lines and factual. $ARGUMENTS',
  },
  {
    name: 'review',
    kind: 'send',
    source: 'builtin',
    template:
      'Review the changes in this workspace against the base commit (use `git diff` with `git status`; the base commit is in .git/sixfinger/base). Look for bugs, missing edge cases, security problems, broken tests and unclear code. Do NOT modify any files. Report concrete findings with `path:line`, ordered by severity, and say if the change looks good. $ARGUMENTS',
  },
  {
    name: 'test',
    kind: 'send',
    source: 'builtin',
    template:
      'Find how this project runs its tests (look at package.json, Makefile, pyproject, CI config), run the test suite, and if anything fails find the cause and fix it, then run it again until it passes. Report what you ran and the result. $ARGUMENTS',
  },
];

/** "/ad argümanlar" → { name, args }; komut değilse null. */
export function parseSlash(text: string): { name: string; args: string } | null {
  const m = /^\/([a-zA-Z][\w-]{0,40})(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() } : null;
}

/** `$ARGUMENTS` yer tutucusunu doldurur; yoksa argümanlar sona eklenir. */
export function expandTemplate(body: string, args: string): string {
  if (body.includes('$ARGUMENTS')) return body.replace(/\$ARGUMENTS/g, args).replace(/[ \t]+$/gm, '').trim();
  return args ? `${body.trim()}\n\n${args}` : body.trim();
}

/** Yazılan "/öntanı"ya uyan komutlar (yerleşikler önce). */
export function matchCommands(all: SlashCommand[], typed: string): SlashCommand[] {
  const q = typed.replace(/^\//, '').toLowerCase();
  return all.filter((c) => c.name.startsWith(q)).sort((a, b) => Number(a.source === 'repo') - Number(b.source === 'repo') || a.name.localeCompare(b.name));
}

/** Repo komut dosyasının (`.claude/commands/x.md`) başındaki `description:` satırı ve gövdesi. */
export function parseRepoCommand(file: string, raw: string): SlashCommand | null {
  const name = /([^/]+)\.md$/i.exec(file)?.[1]?.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!name) return null;
  let body = raw.trim();
  let description = '';
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    description = /^description:\s*(.+)$/im.exec(fm[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    body = body.slice(fm[0].length).trim();
  }
  if (!body) return null;
  if (!description) description = (body.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').slice(0, 90);
  return { name, kind: 'send', template: body, description, source: 'repo' };
}

export interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

/** Kullanıcının soru kartındaki seçimlerini ajana giden tek mesaja çevirir. */
export function buildAnswerText(questions: AskQuestion[], answers: string[][]): string {
  return questions
    .map((q, i) => {
      const a = (answers[i] ?? []).filter(Boolean);
      return `${q.header ? `${q.header}: ` : ''}${q.question} → ${a.length ? a.join(', ') : '—'}`;
    })
    .join('\n');
}

/** Metnin sonundaki "@parça" (imlecteki kelime) varsa onu döndürür: dosya önerisi için. */
export function activeMention(text: string): { query: string; start: number } | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  if (!m) return null;
  return { query: m[1]!, start: text.length - m[1]!.length - 1 };
}
