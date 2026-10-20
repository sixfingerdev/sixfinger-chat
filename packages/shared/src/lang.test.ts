import { describe, expect, it } from 'vitest';
import { chooseTranscript, detectLanguage, langBase, segmentByLanguage, splitSentences } from './lang.ts';

const L = ['tr-TR', 'en-US', 'it-IT'];

describe('detectLanguage', () => {
  it('Türkçe / İngilizce / İtalyanca cümleleri ayırır', () => {
    expect(detectLanguage('Bugün hava çok güzel, dışarı çıkmak istiyorum', L)?.lang).toBe('tr');
    expect(detectLanguage('What is the weather like today in London', L)?.lang).toBe('en');
    expect(detectLanguage('Come sta andando il progetto, non lo so', L)?.lang).toBe('it');
  });

  it('özgün harfler tek kelimede bile ipucu verir', () => {
    expect(detectLanguage('değil', L)?.lang).toBe('tr');
  });

  it('tek aday varsa karar vermez', () => {
    expect(detectLanguage('merhaba dünya', ['tr-TR'])).toBeNull();
  });

  it('betikten bulur', () => {
    expect(detectLanguage('Привет, как дела сегодня', ['tr-TR', 'ru-RU'])?.lang).toBe('ru');
    expect(detectLanguage('これはテストです', ['en-US', 'ja-JP'])?.lang).toBe('ja');
  });

  it('adaylarda olmayan betikte null', () => {
    expect(detectLanguage('Привет, как дела', ['tr-TR', 'en-US'])).toBeNull();
  });

  it('kanıt yoksa null', () => {
    expect(detectLanguage('12345 !!!', L)).toBeNull();
    expect(detectLanguage('xqz', L)).toBeNull();
  });

  it('İ harfini doğru işler', () => {
    expect(detectLanguage('İstanbul için bir plan yapalım', L)?.lang).toBe('tr');
  });
});

describe('chooseTranscript', () => {
  it('yanlış dilde üretilen metin güven yüksek olsa da elenir', () => {
    const i = chooseTranscript(
      [
        { lang: 'tr-TR', text: 'ay em going to the market today', confidence: 0.7 },
        { lang: 'en-US', text: "I'm going to the market today", confidence: 0.85 },
      ],
      L,
      'tr-TR',
    );
    expect(i).toBe(1);
  });

  it('Türkçe konuşmada Türkçe tanıyıcıyı seçer', () => {
    const i = chooseTranscript(
      [
        { lang: 'en-US', text: 'bugün bir yarım kalmış', confidence: 0.4 },
        { lang: 'tr-TR', text: 'bugün hava çok güzel değil mi', confidence: 0.9 },
      ],
      L,
      'en-US',
    );
    expect(i).toBe(1);
  });

  it('boş metinleri atlar, hepsi boşsa -1', () => {
    expect(chooseTranscript([{ lang: 'tr-TR', text: ' ' }], L, 'tr-TR')).toBe(-1);
    expect(chooseTranscript([{ lang: 'tr-TR', text: '' }, { lang: 'en-US', text: 'hello there my friend' }], L, 'tr-TR')).toBe(1);
  });

  it('kanıt yoksa birincil dili tercih eder', () => {
    const i = chooseTranscript(
      [
        { lang: 'en-US', text: 'xqz' },
        { lang: 'tr-TR', text: 'xqz' },
      ],
      L,
      'tr-TR',
    );
    expect(i).toBe(1);
  });
});

describe('segmentByLanguage', () => {
  it('karışık yanıtı dile göre böler ve komşuları birleştirir', () => {
    const segs = segmentByLanguage('Bugün hava çok güzel. Yarın da öyle olacak. The weather is nice and we can go outside. Ciao a tutti, come state?', L, 'tr-TR');
    expect(segs.map((s) => s.lang)).toEqual(['tr', 'en', 'it']);
    expect(segs[0]!.text).toContain('Yarın');
  });

  it('belirsiz cümle önceki dili sürdürür', () => {
    const segs = segmentByLanguage('Merhaba, nasılsın bugün? 42. Tamam mı?', L, 'en-US');
    expect(segs.every((s) => s.lang === 'tr')).toBe(true);
  });

  it('tek dilde tek parça', () => {
    expect(segmentByLanguage('Hello there. How are you?', ['en-US'], 'en-US')).toHaveLength(1);
  });
});

describe('yardımcılar', () => {
  it('langBase', () => {
    expect(langBase('it-IT')).toBe('it');
    expect(langBase('pt_BR')).toBe('pt');
  });
  it('splitSentences', () => {
    expect(splitSentences('Bir. İki! Üç?')).toEqual(['Bir.', 'İki!', 'Üç?']);
  });
});
