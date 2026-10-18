/**
 * Tasarım token'ları — apps/web/src/styles/tokens.css ile birebir aynı değerler.
 * Web'de değişiklik yapılırsa burası da güncellenmeli.
 */

export interface Palette {
  bg: string;
  bgElev: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  onAccent: string;
  inverse: string;
  onInverse: string;
  danger: string;
  dangerSoft: string;
  success: string;
  warning: string;
  overlay: string;
  codeBg: string;
  codeHead: string;
  hl: {
    comment: string;
    keyword: string;
    string: string;
    number: string;
    title: string;
    type: string;
    attr: string;
  };
}

export const dark: Palette = {
  bg: '#0b0b0c',
  bgElev: '#0f0f11',
  surface: '#151517',
  surface2: '#1b1b1e',
  surface3: '#242428',
  line: '#26262a',
  lineStrong: '#37373d',
  text: '#f4f4f5',
  text2: '#a1a1aa',
  text3: '#71717a',
  accent: '#ff6a1a',
  accentHover: '#ff8643',
  accentSoft: 'rgba(255, 106, 26, 0.14)',
  onAccent: '#0b0b0c',
  inverse: '#f4f4f5',
  onInverse: '#0b0b0c',
  danger: '#f2554d',
  dangerSoft: 'rgba(242, 85, 77, 0.14)',
  success: '#3ccf7e',
  warning: '#f5b53d',
  overlay: 'rgba(0, 0, 0, 0.62)',
  codeBg: '#101012',
  codeHead: '#17171a',
  hl: {
    comment: '#6b6b75',
    keyword: '#ff8a4c',
    string: '#8fd3a4',
    number: '#e6c07b',
    title: '#7ab7ff',
    type: '#c9a8ff',
    attr: '#f0b27a',
  },
};

export const light: Palette = {
  bg: '#fafaf9',
  bgElev: '#f3f3f1',
  surface: '#ffffff',
  surface2: '#f0f0ee',
  surface3: '#e7e7e4',
  line: '#e3e3df',
  lineStrong: '#cfcfc9',
  text: '#0b0b0c',
  text2: '#52525b',
  text3: '#8b8b94',
  accent: '#e4510a',
  accentHover: '#c24407',
  accentSoft: 'rgba(228, 81, 10, 0.1)',
  onAccent: '#ffffff',
  inverse: '#0b0b0c',
  onInverse: '#fafaf9',
  danger: '#d6372f',
  dangerSoft: 'rgba(214, 55, 47, 0.1)',
  success: '#1c9a58',
  warning: '#b97a06',
  overlay: 'rgba(20, 20, 22, 0.42)',
  codeBg: '#f6f6f4',
  codeHead: '#ececea',
  hl: {
    comment: '#8b8b94',
    keyword: '#c2410c',
    string: '#17803f',
    number: '#a16207',
    title: '#1d63c9',
    type: '#7a3fd0',
    attr: '#b45309',
  },
};

export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 } as const;

/** Web'deki cubic-bezier(0.22, 1, 0.36, 1) — Reanimated `Easing.bezier` ile kullanılır. */
export const ease = [0.22, 1, 0.36, 1] as const;

export const duration = { fast: 120, med: 220 } as const;

/** Web'deki `skewX(-16deg)` / `skewX(-24deg)` eğik çizgi motifi. */
export const slash = { soft: '-16deg', strong: '-24deg' } as const;

/** expo-font ile yüklenen Geist aileleri (bkz. app/_layout.tsx). */
export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

export type ThemeName = 'dark' | 'light';
