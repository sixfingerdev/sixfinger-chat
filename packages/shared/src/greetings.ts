/**
 * Boş sohbet ekranındaki selamlamalar. Kullanıcı adı varsa kişiselleştirilir, saate göre değişir.
 * `{name}` yer tutucusu yalnızca adlı listelerde bulunur.
 */
type Lang = 'tr' | 'en';
type Bucket = 'morning' | 'afternoon' | 'evening' | 'night';

interface Pool {
  /** Adı bilinen kullanıcı için ({name} içerir). */
  named: string[];
  /** Adı bilinmeyen / misafir için. */
  anon: string[];
}

const GENERIC: Record<Lang, Pool> = {
  tr: {
    named: [
      'Selam {name}',
      'Hoş geldin {name}',
      'Tekrar merhaba {name}',
      'Dönen kim: {name}!',
      '{name} döndü!',
      'Ooo, {name}!',
      'Kimler gelmiş, {name}!',
      'Ne var ne yok {name}?',
      'Nasılsın {name}?',
      'Buyur {name}',
      'Seni bekliyorduk {name}',
      'Bugün ne yapıyoruz {name}?',
      'Neyle uğraşıyoruz {name}?',
      'Hazırım {name}',
      'Dinliyorum {name}',
      'Aklında ne var {name}?',
      'Yine biz, {name}',
      'Evine hoş geldin {name}',
      'Hadi başlayalım {name}',
      'Merhaba {name}, ne lazım?',
      'Sana nasıl yardım edeyim {name}?',
      'Bugün sıra sende {name}',
      '{name}, ne düşünüyorsun?',
      'Bir şey mi sormak istiyorsun {name}?',
      'Hoş bulduk {name}',
      'Konuşalım mı {name}?',
      'Bugün neyi çözüyoruz {name}?',
      'Fikirler sende {name}',
      'Merak ettiğin ne var {name}?',
      'Başlıyoruz {name}',
      'Elim kulağımda {name}',
    ],
    anon: [
      'Merhaba',
      'Selam',
      'Hoş geldin',
      'Ne var ne yok?',
      'Nasılsın?',
      'Buyur',
      'Dinliyorum',
      'Bugün ne yapıyoruz?',
      'Neyle uğraşıyoruz?',
      'Aklında ne var?',
      'Hazırım',
      'Hadi başlayalım',
      'Sana nasıl yardım edeyim?',
      'Bir şey mi soracaksın?',
      'Bugün ne öğrenelim?',
      'Ne konuşalım?',
      'Seni dinliyorum',
      'Ne lazım?',
      'Konuşalım mı?',
      'Bugün neyi çözüyoruz?',
      'Fikirler sende',
      'Merak ettiğin ne var?',
      'Başlıyoruz',
      'Elim kulağımda',
    ],
  },
  en: {
    named: [
      'Hi {name}',
      'Hello {name}',
      'Hey {name}',
      'Welcome back, {name}',
      '{name} returns!',
      'Look who’s here, {name}!',
      'Good to see you, {name}',
      'What’s up, {name}?',
      'How’s it going, {name}?',
      'Ready when you are, {name}',
      'What are we working on, {name}?',
      'What’s on your mind, {name}?',
      'Back at it, {name}?',
      'Let’s get started, {name}',
      'Hi {name}, what do you need?',
      'How can I help, {name}?',
      'Nice to see you again, {name}',
      'Go ahead, {name}',
      'I’m all ears, {name}',
      'Your move, {name}',
      '{name}, what’s the plan?',
      'Something on your mind, {name}?',
      'Hello again, {name}',
      'There you are, {name}!',
      'Let’s make something, {name}',
      'Shall we talk, {name}?',
      'What are we solving today, {name}?',
      'Ideas welcome, {name}',
      'Curious about something, {name}?',
      'Here we go, {name}',
      'Talk to me, {name}',
    ],
    anon: [
      'Hello',
      'Hi there',
      'Hey',
      'Welcome',
      'What’s up?',
      'How’s it going?',
      'Ready when you are',
      'What are we working on?',
      'What’s on your mind?',
      'Let’s get started',
      'How can I help?',
      'I’m all ears',
      'Go ahead',
      'What do you need?',
      'What shall we explore?',
      'Ask me anything',
      'Let’s make something',
      'Something on your mind?',
      'Shall we talk?',
      'What are we solving today?',
      'Ideas welcome',
      'Curious about something?',
      'Here we go',
      'Talk to me',
    ],
  },
};

const BY_TIME: Record<Lang, Record<Bucket, Pool>> = {
  tr: {
    morning: {
      named: ['Günaydın {name}', 'Günaydın {name}, kahven hazır mı?', 'Sabah sabah ne var {name}?', 'Güne başlıyoruz {name}', 'Erkenciymişsin {name}', 'Güne enerjik başla {name}', 'Sabahın hayırlı olsun {name}', 'Uyanmışsın {name}!', 'Yeni gün, yeni fikirler {name}', 'Sabah kahvesi eşliğinde {name}?'],
      anon: ['Günaydın', 'Günaydın, kahven hazır mı?', 'Sabah sabah ne var?', 'Güne başlıyoruz', 'Erkencisin!', 'Güne enerjik başla', 'Sabahın hayırlı olsun', 'Uyandın mı?', 'Yeni gün, yeni fikirler', 'Sabah kahvesi eşliğinde?'],
    },
    afternoon: {
      named: ['İyi günler {name}', 'Tünaydın {name}', 'Öğleden sonra nasıl gidiyor {name}?', 'Günün nasıl geçiyor {name}?', 'Mola zamanı mı {name}?', 'Gün ortası enerjisi {name}'],
      anon: ['İyi günler', 'Tünaydın', 'Öğleden sonra nasıl gidiyor?', 'Günün nasıl geçiyor?', 'Mola zamanı mı?', 'Gün ortası enerjisi'],
    },
    evening: {
      named: ['İyi akşamlar {name}', 'Akşamın hayırlı olsun {name}', 'Günün nasıl geçti {name}?', 'Akşam keyfi {name}?', 'Gün biterken ne var {name}?', 'Çayını aldın mı {name}?', 'Akşam sohbeti {name}?', 'Günü toparlıyoruz {name}'],
      anon: ['İyi akşamlar', 'Akşamın hayırlı olsun', 'Günün nasıl geçti?', 'Akşam keyfi?', 'Gün biterken ne var?', 'Çayını aldın mı?', 'Akşam sohbeti?', 'Günü toparlıyoruz'],
    },
    night: {
      named: ['Merhaba gece kuşu {name}', 'Gece kuşu {name} yine burada', 'Uyumadın mı {name}?', 'İyi geceler {name}', 'Gece yarısı fikirleri {name}?', 'Gece vardiyası mı {name}?', 'Uykun yok mu {name}?', 'Geç oldu {name}, ne var?', 'Sessiz saatler {name}', 'Gece sohbeti {name}?'],
      anon: ['Merhaba gece kuşu', 'Uyumadın mı?', 'İyi geceler', 'Gece yarısı fikirleri?', 'Gece vardiyası mı?', 'Uykun yok mu?', 'Geç oldu, ne var?', 'Gece kuşları burada', 'Sessiz saatler', 'Gece sohbeti?'],
    },
  },
  en: {
    morning: {
      named: ['Good morning, {name}', 'Morning, {name}! Coffee yet?', 'Rise and shine, {name}', 'Early bird, {name}!', 'Fresh start, {name}?', 'Morning, {name}. What’s the plan?', 'Up already, {name}?', 'Let’s kick off the day, {name}', 'New day, new ideas, {name}', 'Coffee and ideas, {name}?'],
      anon: ['Good morning', 'Morning! Coffee yet?', 'Rise and shine', 'Early bird!', 'Fresh start?', 'Morning. What’s the plan?', 'Up already?', 'Let’s kick off the day', 'New day, new ideas', 'Coffee and ideas?'],
    },
    afternoon: {
      named: ['Good afternoon, {name}', 'How’s your day, {name}?', 'Afternoon, {name}', 'Midday break, {name}?', 'Keeping busy, {name}?', 'Hope the day’s treating you well, {name}'],
      anon: ['Good afternoon', 'How’s your day?', 'Afternoon!', 'Midday break?', 'Keeping busy?', 'Hope the day’s treating you well'],
    },
    evening: {
      named: ['Good evening, {name}', 'How was your day, {name}?', 'Evening, {name}', 'Winding down, {name}?', 'Evening plans, {name}?', 'Long day, {name}?', 'Evening chat, {name}?', 'Wrapping up the day, {name}'],
      anon: ['Good evening', 'How was your day?', 'Evening!', 'Winding down?', 'Evening plans?', 'Long day?', 'Evening chat?', 'Wrapping up the day'],
    },
    night: {
      named: ['Hello night owl {name}', 'Night owl {name} is back', 'Still up, {name}?', 'Burning the midnight oil, {name}?', 'Late-night ideas, {name}?', 'Good night, {name}… or not yet?', 'Can’t sleep, {name}?', 'The night shift, {name}?', 'Quiet hours, {name}', 'Midnight chat, {name}?'],
      anon: ['Hello, night owl', 'Still up?', 'Burning the midnight oil?', 'Late-night ideas?', 'Can’t sleep?', 'The night shift?', 'Night owls unite', 'Quiet hours. What’s up?', 'Midnight chat?', 'The world’s asleep. You’re not'],
    },
  },
};

export function timeBucket(hour: number): Bucket {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export interface GreetingOptions {
  locale: Lang;
  /** Giriş yapmış kullanıcının hitap adı; yoksa adsız selamlama seçilir. */
  name?: string;
  /** Yerel saat (0–23). */
  hour: number;
  /** [0,1) rastgele sayı üreteci (testlerde sabitlenebilir). */
  rand?: () => number;
}

/** Saate ve (varsa) isme göre rastgele bir selamlama döndürür. Saat dilimine özel olanlar daha sık seçilir. */
export function pickGreeting({ locale, name, hour, rand = Math.random }: GreetingOptions): string {
  const key = name?.trim() ? 'named' : 'anon';
  const timed = BY_TIME[locale][timeBucket(hour)][key];
  const generic = GENERIC[locale][key];
  // %60 saate özel, %40 genel
  const list = rand() < 0.6 ? timed : generic;
  const line = list[Math.floor(rand() * list.length)] ?? generic[0]!;
  return line.replaceAll('{name}', name?.trim() ?? '');
}

export const GREETING_POOLS = { GENERIC, BY_TIME };
