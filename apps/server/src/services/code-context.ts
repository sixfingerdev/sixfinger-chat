import type { AiMessage } from './ai.ts';
import { expandAssistant, fitHistory, type HistoryItem } from './prompt.ts';

/**
 * Code oturumlarında bağlam bütçesi: araç çıktıları büyüktür, 40+ adımlık bir çalışmada bağlamı doldurur.
 * Eski araç sonuçlarını kırpar (aider/opencode dersi: bayat dosya içeriği yerine yeniden okutmak daha ucuz ve doğru).
 */
const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

export const messagesTokens = (messages: AiMessage[]): number =>
  messages.reduce((n, m) => n + estimateTokens(m.content) + (m.tool_calls ? estimateTokens(JSON.stringify(m.tool_calls)) : 0) + (m.images?.length ?? 0) * 1_200, 0);

/** `skill` aracının sonuçları bununla başlar: son birkaçı kırpılmaz (talimat bağlamdan düşmesin). */
export const SKILL_MARK = '[skill:';
const SKILL_KEEP = 3;

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
    const skillIdx = new Set(toolIdx.filter((i) => messages[i]!.content.startsWith(SKILL_MARK)).slice(-SKILL_KEEP));
    out = messages.map((m, i) => {
      if (m.role !== 'tool' || i >= protectedFrom || skillIdx.has(i) || m.content.length <= o.trimTo + TRIM_NOTE.length) return m;
      return { ...m, content: m.content.slice(0, o.trimTo) + TRIM_NOTE };
    });
    if (messagesTokens(out) <= o.budgetTokens || keep <= 2) return out;
    keep = Math.max(2, Math.floor(keep / 2));
  }
}

// ---------- Özetleme (compaction) ----------
// Kırpma yetmediğinde eski konuşma modele özetlettirilir; son tur(lar) olduğu gibi kalır. Özet, mesajın `compaction` parçasında
// saklanır; sonraki turlarda geçmiş "özet + sonrası" olarak kurulur (opencode/aider derslerinden: özet yoksa uzun oturum ölür).

export const SUMMARY_HEADER = '[Summary of the earlier conversation, written before the context window was compacted. Treat it as accurate, but re-read files before editing them.]';

export const SUMMARIZER_PROMPT = [
  'You are summarizing a software engineering session so the work can continue after the earlier conversation is removed from the context window.',
  'Write a dense, factual summary in English. Keep identifiers, file paths, commands and error messages exact. Use these sections:',
  '## Goal: what the user wants; quote their key instructions and constraints verbatim.',
  '## Done so far: files created or changed (paths) and what changed; commands run and their outcome.',
  '## Findings: facts learned about the codebase (structure, conventions, how to run tests/build), approaches that failed and why.',
  '## Current state: exactly where the work stands right now.',
  '## Next steps: the remaining work, in order.',
  'Do not invent anything and do not include long tool output; a short error message that matters is fine. At most about 1500 words.',
].join('\n');

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Özetleyiciye verilecek döküm. Çok uzunsa ortası atılır (baş: eski özet/istek, son: en yeni iş). */
export function renderTranscript(messages: AiMessage[], maxChars: number): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`USER: ${clip(m.content, 6_000)}`);
    else if (m.role === 'assistant') {
      if (m.content.trim()) lines.push(`ASSISTANT: ${clip(m.content, 3_000)}`);
      for (const c of m.tool_calls ?? []) lines.push(`ASSISTANT CALLS ${c.function.name}(${clip(c.function.arguments, 400)})`);
    } else if (m.role === 'tool') lines.push(`RESULT: ${clip(m.content, 1_000)}`);
  }
  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.2);
  return `${text.slice(0, head)}\n[… middle of the conversation omitted …]\n${text.slice(text.length - (maxChars - head))}`;
}

export interface CompactionSplit {
  head: AiMessage[];
  tail: AiMessage[];
  /** Kuyruğun `messages` içindeki başlangıç dizini. */
  tailStart: number;
}

/**
 * Konuşmayı baş (özetlenecek) ve kuyruğa (olduğu gibi kalacak) böler. Kuyruk yalnızca içinde bulunulan turdan (turnStart ve sonrası)
 * oluşur ve araç çağıran bir asistan mesajıyla (ya da turun kullanıcı mesajıyla) başlar; böylece araç çağrısı/sonucu çiftleri bölünmez
 * ve kuyruğun parçaları sonraki turlarda mesajın parçalarından yeniden kurulabilir. Özetlenecek bir şey yoksa null.
 */
export function splitForCompaction(messages: AiMessage[], turnStart: number, keepTokens: number): CompactionSplit | null {
  const cost = (from: number) => messagesTokens(messages.slice(from));
  let at = -1;
  if (cost(turnStart) <= keepTokens) at = turnStart;
  else {
    let lastCall = -1;
    for (let i = turnStart + 1; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
      lastCall = i;
      if (cost(i) <= keepTokens) {
        at = i;
        break;
      }
    }
    if (at < 0) at = lastCall; // en son tur bile bütçeyi aşıyor: yine de yalnızca onu koru
  }
  if (at <= 1) return null;
  return { head: messages.slice(1, at), tail: messages.slice(at), tailStart: at };
}

export interface CompactionResult {
  messages: AiMessage[];
  turnStart: number;
  /** Özet mesajının metni (parçada saklanır). */
  summaryMessage: string;
  /** Kuyruğun ilk araç çağrısı kimliği (parçalardan yeniden kurmak için); kuyruk yalnızca kullanıcı mesajıysa null. */
  keepFromId: string | null;
  /** Kuyruk turun kullanıcı mesajıyla başlıyor. */
  keepUser: boolean;
}

/** Baş yerine özet koyar: [sistem, (özet ± kullanıcı mesajı), ...kuyruk]. */
export function applyCompaction(messages: AiMessage[], split: CompactionSplit, turnStart: number, summary: string, userRequest: string): CompactionResult {
  const keepUser = split.tailStart === turnStart;
  const first = split.tail[0]!;
  const body = `${SUMMARY_HEADER}\n\n${summary.trim()}`;
  if (keepUser) {
    // "/compact" kendi başına bir istek değildir: yalnızca özet kalır.
    const merged: AiMessage = { role: 'user', content: first.content.trim() === '/compact' ? body : `${body}\n\n[Current request from the user]\n${first.content}` };
    const out = [messages[0]!, merged, ...split.tail.slice(1)];
    return { messages: out, turnStart: 1, summaryMessage: body, keepFromId: split.tail.find((m) => m.tool_calls?.length)?.tool_calls?.[0]?.id ?? null, keepUser };
  }
  const withRequest = `${body}\n\n[Current request from the user]\n${clip(userRequest, 4_000)}`;
  return { messages: [messages[0]!, { role: 'user', content: withRequest }, ...split.tail], turnStart: 1, summaryMessage: withRequest, keepFromId: first.tool_calls?.[0]?.id ?? null, keepUser };
}

/**
 * Yeni turun geçmişi: son özetleme parçası varsa "özet + (korunan kuyruk) + sonrası"; yoksa düz sığdırma.
 * `budget`: token bütçesi.
 */
export function buildCodeHistory(history: HistoryItem[], budget: number): AiMessage[] {
  let at: { i: number; j: number } | null = null;
  history.forEach((h, i) =>
    h.parts?.forEach((p, j) => {
      if (p.type === 'tool' && p.name === 'compaction' && p.status === 'done' && p.output) at = { i, j };
    }),
  );
  if (!at) return fitHistory(history, budget);
  const { i, j } = at as { i: number; j: number };
  const item = history[i]!;
  const part = item.parts![j]! as Extract<NonNullable<HistoryItem['parts']>[number], { type: 'tool' }>;
  const summary = part.output!;
  const keepFromId = typeof part.meta?.keepFromId === 'string' ? part.meta.keepFromId : null;
  const keepUser = part.meta?.keepUser === true;
  const from = keepFromId ? item.parts!.findIndex((p) => p.type === 'tool' && p.id === keepFromId) : -1;
  const parts = [...(from >= 0 && from < j ? item.parts!.slice(from, j) : []), ...item.parts!.slice(j + 1)];
  const text = parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : '')).join('');
  const own: AiMessage[] = parts.length ? expandAssistant({ role: 'assistant', content: text, parts }) : [];
  const prevUser = history[i - 1];
  const userMsgs: AiMessage[] = keepUser && prevUser?.role === 'user' && prevUser.content.trim() !== '/compact' ? [{ role: 'user', content: prevUser.content }] : [];
  const rest = fitHistory(history.slice(i + 1), Math.max(2_000, budget - estimateTokens(summary) - messagesTokens(own)));
  const tailMsgs = [...userMsgs, ...own, ...rest];
  if (tailMsgs[0]?.role === 'user') return [{ role: 'user', content: `${summary}\n\n${userMsgs.length ? '[Current request from the user]' : '[New message from the user]'}\n${tailMsgs[0].content}` }, ...tailMsgs.slice(1)];
  return [{ role: 'user', content: summary }, ...tailMsgs];
}
