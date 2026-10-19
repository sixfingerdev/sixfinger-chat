/**
 * Ajan çalışırken durum çubuğunda dönen oyunlu kelimeler ("Tinkering…", "Sixfingering…"). Her dil kendi listesini kullanır;
 * kelime birkaç saniyede bir değişir ve art arda aynısı gelmez.
 */
export const STATUS_WORDS = {
  en: [
    'Sixfingering', 'Tinkering', 'Scheming', 'Conjuring', 'Wrangling', 'Noodling', 'Pondering', 'Plotting', 'Fiddling', 'Brewing',
    'Untangling', 'Whittling', 'Cobbling', 'Hatching', 'Percolating', 'Rummaging', 'Sleuthing', 'Finagling', 'Doodling', 'Mulling',
    'Cracking knuckles', 'Counting fingers', 'Stitching', 'Weaving', 'Polishing', 'Tightening bolts', 'Sharpening pencils', 'Juggling',
  ],
  tr: [
    'Altı parmakla uğraşıyor', 'Kurcalıyor', 'Plan kuruyor', 'Kurguluyor', 'Karıştırıyor', 'Demliyor', 'Kuluçkaya yatırıyor', 'Çözüyor',
    'Eşeleniyor', 'Yoğuruyor', 'Kod dokuyor', 'Parmaklarını çıtlatıyor', 'Sixfingerliyor', 'Tıkır tıkır çalışıyor', 'Düğüm çözüyor',
    'Vidaları sıkıyor', 'Kalem açıyor', 'Hokkabazlık yapıyor', 'Cilalıyor', 'Dikiş atıyor', 'Parmak sayıyor', 'Köşe kapmaca oynuyor', 'Tasarlıyor',
  ],
} as const;

/** `previous` dışında rastgele bir kelime seçer. `rand` testler içindir. */
export function pickStatusWord(locale: 'tr' | 'en', previous?: string, rand: () => number = Math.random): string {
  const list = STATUS_WORDS[locale];
  const pool = previous ? list.filter((w) => w !== previous) : list;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!;
}
