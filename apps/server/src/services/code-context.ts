import type { AiMessage } from './ai.ts';

/**
 * Code oturumlarında bağlam bütçesi: araç çıktıları büyüktür, 40+ adımlık bir çalışmada bağlamı doldurur.
 * Eski araç sonuçlarını kırpar (aider/opencode dersi: bayat dosya içeriği yerine yeniden okutmak daha ucuz ve doğru).
 */
const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

export const messagesTokens = (messages: AiMessage[]): number =>
  messages.reduce((n, m) => n + estimateTokens(m.content) + (m.tool_calls ? estimateTokens(JSON.stringify(m.tool_calls)) : 0), 0);

const TRIM_NOTE = '\n[… older output trimmed to save context. Re-run the command or re-read the file if you need it again.]';

export interface PruneOptions {
  /** Son bu kadar araç sonucu olduğu gibi kalır. */
  keepRecent: number;
  /** Eski sonuçlar bu uzunluğa kırpılır (karakter). */
  trimTo: number;
  /** Bu bütçenin altına inene kadar daha agresif kırpılır. */
  budgetTokens: number;
}

/** Araç sonuçlarını (yerinde değil, kopya) kırpar. Bütçe aşılırsa sakladığı "son N" sayısını küçültür. */
export function pruneToolResults(messages: AiMessage[], o: PruneOptions): AiMessage[] {
  const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  let keep = o.keepRecent;
  let out = messages;
  for (;;) {
    // Korunacak son `keep` sonuç; daha az sonuç varsa hepsi korunur.
    const protectedFrom = toolIdx.length > keep ? toolIdx[toolIdx.length - keep]! : 0;
    out = messages.map((m, i) => {
      if (m.role !== 'tool' || i >= protectedFrom || m.content.length <= o.trimTo + TRIM_NOTE.length) return m;
      return { ...m, content: m.content.slice(0, o.trimTo) + TRIM_NOTE };
    });
    if (messagesTokens(out) <= o.budgetTokens || keep <= 2) return out;
    keep = Math.max(2, Math.floor(keep / 2));
  }
}
