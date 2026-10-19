/**
 * Code ekranının boş durum başlıkları: kısa, geliştirici esprili. Saate ve güne göre değişir.
 * Adı bilinen kullanıcı için bazen `{name}` içeren bir varyant seçilir.
 */
import { timeBucket } from './greetings.ts';

type Lang = 'tr' | 'en';
type Bucket = 'morning' | 'afternoon' | 'evening' | 'night';

const BY_TIME: Record<Lang, Record<Bucket, string[]>> = {
  tr: {
    morning: ['Sabah derlemesi', 'İlk commit', 'Kahve ve kod', 'Sabah birleştirmesi', 'Erken deploy', 'Temiz bir başlangıç', 'Güne git pull ile'],
    afternoon: ['Öğleden sonra refaktörü', 'Öğle arası commit', 'Hata avı', 'Test zamanı', 'Bir de şunu düzeltelim', 'Derleme sürüyor', 'Yeşil testler'],
    evening: ['Akşam mesaisi', 'Son bir PR', 'Akşam deploy', 'Günü kapatalım', 'Bir özellik daha', 'Akşam hata ayıklama'],
    night: ['Gece derlemesi', 'Gece vardiyası', 'Uykusuz commit', 'Sadece bir hata daha', 'Gece kuşu modu', 'Herkes uyurken'],
  },
  en: {
    morning: ['Morning build', 'First commit', 'Coffee and code', 'Morning merge', 'Early deploy', 'A clean start', 'Start with git pull'],
    afternoon: ['Afternoon refactor', 'Lunch commit', 'Bug hunt', 'Test time', 'One more fix', 'Build in progress', 'Green tests'],
    evening: ['Evening shift', 'One last PR', 'Evening deploy', 'Wrap up the day', 'One more feature', 'Evening debugging'],
    night: ['Night build', 'Night shift', 'Sleepless commit', 'Just one more bug', 'Night owl mode', 'While everyone sleeps'],
  },
};

const FRIDAY: Record<Lang, string[]> = {
  tr: ['Cuma deploy\'u mu?', 'Cuma günü prod\'a dokunmayalım', 'Hafta sonu öncesi son commit'],
  en: ['Friday deploy?', 'Never deploy on Friday', 'Last commit before the weekend'],
};
const WEEKEND: Record<Lang, string[]> = {
  tr: ['Hafta sonu hack\'i', 'Pazar projesi', 'Yan proje zamanı'],
  en: ['Weekend hack', 'Sunday project', 'Side project time'],
};
const NAMED: Record<Lang, string[]> = {
  tr: ['{name}, {title}', '{title}, {name}'],
  en: ['{name}, {title}', '{title}, {name}'],
};

export interface CodeGreetingOptions {
  locale: Lang;
  name?: string;
  hour: number;
  /** 0 = Pazar … 6 = Cumartesi (`Date#getDay`). */
  day: number;
  rand?: () => number;
}

export function pickCodeGreeting({ locale, name, hour, day, rand = Math.random }: CodeGreetingOptions): string {
  const timed = BY_TIME[locale][timeBucket(hour)];
  let pool = timed;
  const r = rand();
  if (day === 5 && hour >= 12 && r < 0.45) pool = FRIDAY[locale];
  else if ((day === 6 || day === 0) && r < 0.4) pool = WEEKEND[locale];
  const title = pool[Math.floor(rand() * pool.length)] ?? timed[0]!;
  const who = name?.trim();
  if (who && rand() < 0.25) {
    const tpl = NAMED[locale][Math.floor(rand() * NAMED[locale].length)]!;
    return tpl.replace('{name}', who).replace('{title}', title);
  }
  return title;
}

export const CODE_GREETING_POOLS = { BY_TIME, FRIDAY, WEEKEND };
