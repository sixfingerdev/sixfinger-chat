/**
 * Code kredisi: günlük bütçe üç kalemle harcanır — model (token), sandbox'ın açık kaldığı süre ve diskte duran çalışma alanı.
 * Disk doldukça çalışma süresi daha pahalıdır: boş alan 1×, tavana dayanmış alan 3×.
 * Katsayılar kaba başlangıç değerleridir; Pi'de gerçek kullanım görüldükçe buradan ayarlanır.
 */
export const CODE_CREDIT_WEIGHTS = {
  /** 1000 Qwen tokeni (girdi + çıktı). */
  qwenPer1kTokens: 0.05,
  /**
   * Claude yedeğine düşülürse. Kullanıcı bunu seçmedi (Qwen'e ulaşılamadı), bu yüzden Qwen ile aynı fiyat.
   * Bedrock harcamasını kullanıcı kredisi değil, sunucudaki genel günlük token sınırı (CODE_CLAUDE_DAILY_TOKENS) korur.
   */
  claudePer1kTokens: 0.05,
  /** Sandbox açıkken dakika başına, boş diskte. */
  sandboxPerMinute: 0.2,
  /** Diskte duran çalışma alanı: GB başına saat. */
  diskRentPerGbHour: 0.1,
  /** Doluluk 1 iken çarpana eklenen değer: çarpan = 1 + diskFillBoost × doluluk. */
  diskFillBoost: 2,
} as const;

export type CodeModelKind = 'qwen' | 'claude';

/** Doluluk (0..1) → çalışma süresi çarpanı (1..3). */
export function diskMultiplier(usedMb: number, quotaMb: number): number {
  if (quotaMb <= 0) return 1;
  const fill = Math.min(1, Math.max(0, usedMb / quotaMb));
  return 1 + CODE_CREDIT_WEIGHTS.diskFillBoost * fill;
}

/** Girdi (bağlam) token'ları önbellekten ucuz geldiği için çıktıdan daha hafif sayılır. */
export const INPUT_TOKEN_WEIGHT = 0.25;
export const weightedTokens = (tokensIn: number, tokensOut: number): number => tokensIn * INPUT_TOKEN_WEIGHT + tokensOut;

export interface CreditUsage {
  model?: CodeModelKind;
  /** Ağırlıklı token sayısı (`weightedTokens`). */
  tokens?: number;
  sandboxSeconds?: number;
  diskUsedMb: number;
  diskQuotaMb: number;
  /** Çalışma alanının diskte beklediği süre (saat). */
  rentHours?: number;
}

export function creditsFor(u: CreditUsage): number {
  const w = CODE_CREDIT_WEIGHTS;
  const perK = u.model === 'claude' ? w.claudePer1kTokens : w.qwenPer1kTokens;
  const model = ((u.tokens ?? 0) / 1000) * perK;
  const run = ((u.sandboxSeconds ?? 0) / 60) * w.sandboxPerMinute * diskMultiplier(u.diskUsedMb, u.diskQuotaMb);
  const rent = (u.diskUsedMb / 1024) * (u.rentHours ?? 0) * w.diskRentPerGbHour;
  return Math.round((model + run + rent) * 1000) / 1000;
}
