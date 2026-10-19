/**
 * SixFinger Code'un maskotu: altı parmaklı, uyuyan piksel bir el. Tek renk (currentColor): koyu temada beyaz, açıkta siyah.
 * `#` gövde, `.` boş (gözler ve ağız gövdenin içindeki boşluklardır, yani zeminin rengi).
 * Her istemci kendi çizim katmanında (SVG) bu ızgarayı kareler olarak çizer.
 */
const FINGERS = [
  '......##.........',
  '......##.##......',
  '...##.##.##.##...',
  '...##.##.##.##.##',
  '##.##.##.##.##.##',
  '##.##.##.##.##.##',
  '##.##.##.##.##.##',
];
const PALM = [
  '#################',
  '#################',
  '#################',
  '####...###...####',
  '#################',
  '.#######.#######.',
  '..#############..',
  '...###########...',
];
const WRIST = ['.....#######.....', '.....#######.....'];
/** Uyku harfi "z" (3×4); istemci üç tanesini büyüyerek yükselecek biçimde dizer. */
const Z = ['###', '..#', '.#.', '###'];

export const CODE_MASCOT = {
  /** Gövde ızgarası (satır dizisi, hepsi aynı genişlikte). */
  grid: [...FINGERS, ...PALM, ...WRIST],
  width: 17,
  height: FINGERS.length + PALM.length + WRIST.length,
  z: Z,
} as const;
