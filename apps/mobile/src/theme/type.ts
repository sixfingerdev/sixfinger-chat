import type { TextStyle } from 'react-native';
import { fonts } from './tokens.ts';

/** Web'deki tipografi ölçeği (15px gövde, geniş harf aralıklı etiketler). */
export const type = {
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23 } satisfies TextStyle,
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 } satisfies TextStyle,
  title: { fontFamily: fonts.sansSemibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 } satisfies TextStyle,
  heading: { fontFamily: fonts.sansSemibold, fontSize: 16, lineHeight: 22 } satisfies TextStyle,
  /** Büyük harfli, geniş aralıklı küçük etiket (öneri kartı başlıkları gibi). */
  label: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 } satisfies TextStyle,
  wordmark: { fontFamily: fonts.sansSemibold, letterSpacing: 3.4 } satisfies TextStyle,
};
