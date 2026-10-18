import { getPersona, MODELS, type UserSettings } from '@sixfinger/shared';
import type { AiMessage } from './ai.ts';

export interface PromptContext {
  locale: 'tr' | 'en';
  personaId: string;
  settings: UserSettings;
  memories: string[];
  displayName: string;
  now?: Date;
}

const BASE_MODEL_NAME = 'GPT-OSS 20B';

export function buildSystemPrompt(ctx: PromptContext): string {
  const persona = getPersona(ctx.personaId);
  const now = ctx.now ?? new Date();
  const date = new Intl.DateTimeFormat(ctx.locale === 'tr' ? 'tr-TR' : 'en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(now);

  const parts: string[] = [
    `Sen SixFinger AI'sın: SixFinger tarafından sunulan bir yapay zekâ sohbet asistanısın. Adın sorulduğunda kendini "SixFinger AI" olarak tanıt. Cevaplarına asla ad, etiket ya da "SixFinger AI:" gibi bir önekle başlama; doğrudan cevabı yaz. ` +
      `Altyapıda hangi modelin çalıştığı sorulursa, SixFinger AI'nin şu an ${BASE_MODEL_NAME} açık ağırlıklı dil modelini kullandığını söyle; başka ayrıntı uydurma. ` +
      `Kendini ChatGPT, OpenAI veya başka bir ürün olarak tanıtma.`,
    `Şu anki tarih ve saat: ${date} (İstanbul). Gerçek zamanlı bilgiye, internete veya kullanıcının dosyalarına erişimin yok; bilmediğin ya da emin olmadığın şeyi uydurma, dürüstçe söyle.`,
    `Dil: Kullanıcı hangi dilde yazıyorsa o dilde cevap ver. Belirsizse ${ctx.locale === 'tr' ? 'Türkçe' : 'İngilizce'} kullan. Doğal, akıcı ve net yaz.`,
    `Biçim: Cevapları Markdown ile yaz. Kod için dil etiketli üçlü ters tırnak bloğu kullan. Matematik için satır içi $...$ ve blok $$...$$ (LaTeX) kullan. ` +
      `Başlıkları, listeleri ve tabloları yalnızca içeriği gerçekten netleştiriyorsa kullan; kısa sorulara kısa cevap ver.`,
    `Tutum: Yardımsever ve doğrudan ol. Gereksiz özür, dolgu cümlesi ve uyarı yazma. Zararlı, yasa dışı veya başkalarına zarar verebilecek taleplerde nazikçe ve kısaca reddet, mümkünse güvenli bir alternatif öner.`,
  ];

  if (persona.prompt) parts.push(`Rol: ${persona.prompt}`);

  const s = ctx.settings;
  const user: string[] = [];
  const name = s.customName || ctx.displayName;
  if (name) user.push(`Kullanıcının hitap adı: ${name}`);
  if (s.about) user.push(`Kullanıcı hakkında: ${s.about}`);
  if (user.length) parts.push(`Kullanıcı bilgisi:\n${user.join('\n')}`);
  if (s.instructions) {
    parts.push(
      `Kullanıcının özel talimatları (yukarıdaki genel kurallarla çelişmedikçe uygula):\n${s.instructions}`,
    );
  }
  if (ctx.memories.length) {
    parts.push(
      `Kullanıcının senden hatırlamanı istediği bilgiler (ilgili olduğunda kullan, her cevapta tekrar etme):\n` +
        ctx.memories.map((m) => `- ${m}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** Kabaca token tahmini (Türkçe için ~3.5 karakter/token). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5) + 4;

export interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** Geçmişi token bütçesine sığdırır: en yeniden geriye doğru ekler, son kullanıcı mesajı daima kalır. */
export function fitHistory(history: HistoryItem[], budget: number): AiMessage[] {
  const out: AiMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    let content = m.content;
    let cost = estimateTokens(content);
    if (i === history.length - 1 && cost > budget) {
      content = content.slice(0, Math.floor(budget * 3.5));
      cost = budget;
    }
    if (out.length > 0 && used + cost > budget) break;
    out.unshift({ role: m.role, content });
    used += cost;
  }
  // Konuşma "user" ile başlamalı.
  while (out.length > 1 && out[0]!.role !== 'user') out.shift();
  return out;
}

export function renderUserContent(content: string, attachments: { name: string; text: string }[]): string {
  if (!attachments.length) return content;
  const blocks = attachments.map((a) => `<ek ad="${a.name.replace(/"/g, "'")}">\n${a.text}\n</ek>`);
  return `${blocks.join('\n\n')}\n\n${content}`;
}

export function cleanTitle(raw: string, fallback: string): string {
  let t = raw
    .replace(/<[^>]+>/g, '')
    .split('\n')[0]!
    .replace(/^["'“”‘’`*#\s]+|["'“”‘’`*.\s]+$/g, '')
    .trim();
  if (!t) t = fallback;
  t = t.replace(/\s+/g, ' ');
  if (t.length > 60) t = `${t.slice(0, 57).trimEnd()}…`;
  return t;
}

export const fallbackTitle = (userText: string): string => {
  const t = userText.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 45).trimEnd()}…` : t || 'Yeni sohbet';
};

export function titlePrompt(userText: string, assistantText: string, locale: 'tr' | 'en'): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        `Verilen sohbet için kısa bir başlık üret. Kurallar: 2-5 kelime, ${locale === 'tr' ? 'Türkçe' : 'İngilizce'} ` +
        `(kullanıcı başka dilde yazdıysa o dilde), tırnak ve noktalama yok, emoji yok. Sadece başlığı yaz.`,
    },
    {
      role: 'user',
      content: `Kullanıcı: ${userText.slice(0, 500)}\n\nAsistan: ${assistantText.slice(0, 400)}`,
    },
  ];
}

export function memoryPrompt(userText: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'Kullanıcının hatırlanmasını istediği bilgiyi tek, kısa ve kalıcı bir cümleye çevir (en fazla 200 karakter). ' +
        'Kullanıcının dilinde, "Kullanıcı ..." biçiminde yaz. Kalıcı bir bilgi yoksa sadece NONE yaz. Başka hiçbir şey yazma.',
    },
    { role: 'user', content: userText.slice(0, 1_000) },
  ];
}

export const MODEL_ID = MODELS[0]!.id;
