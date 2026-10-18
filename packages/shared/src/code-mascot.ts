/**
 * SixFinger Code'un maskotu: altı parmaklı, uyuyan piksel bir el. Tek renk (currentColor): koyu temada beyaz, açıkta siyah.
 * `#` gövde, `o` göz/ağız (boşluk gibi çizilir, yani zeminin rengi), `.` boş.
 * Her istemci kendi çizim katmanında (SVG) bu ızgarayı kareler olarak çizer.
 */
const FINGER_ROWS = [
  '..##...........##..',
  '..##...##.##...##..',
  '.###..###.###..###.',
  '.###..###.###..###.',
  '.###..###.###..###.',
];
const PALM = [
  '###################',
  '###################',
  '###################',
  '##.oo.#######.oo.##',
  '###################',
  '######.o###o.######',
  '.#################.',
  '..###############..',
  '....###########....',
];
/** Uyku harfleri: gövdenin sağ üstünde yükselen üç "z" (ızgara, gövdeden bağımsız). */
const ZZZ = ['.###..', '..#...', '.###..'];

export const CODE_MASCOT = {
  /** Gövde ızgarası (satır dizisi, hepsi aynı genişlikte). */
  grid: [...FINGER_ROWS, ...PALM],
  width: 19,
  height: FINGER_ROWS.length + PALM.length,
  zzz: ZZZ,
} as const;
