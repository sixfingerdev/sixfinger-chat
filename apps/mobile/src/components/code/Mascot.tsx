import { useEffect, useMemo } from 'react';
import Svg, { G, Path } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { CODE_MASCOT } from '@sixfinger/shared';
import { useTheme } from '../../theme/index.tsx';

const AnimatedG = Animated.createAnimatedComponent(G);
const LOOP = 3_200;

/** Satırlardaki ardışık `ch` hücrelerini tek dikdörtgen olarak birleştirir (az SVG öğesi için). */
function runsPath(rows: readonly string[], ch: string, s: number, ox = 0, oy = 0): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== ch) {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w++;
      d += `M${ox + x * s} ${oy + y * s}h${w * s}v${s}h${-w * s}z`;
      x += w;
    }
  });
  return d;
}

const glyph = (): readonly string[] => CODE_MASCOT.z;

function Zee({ index, s, x, y, color }: { index: number; s: number; x: number; y: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(index * 520, withRepeat(withSequence(withTiming(1, { duration: LOOP - 700, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 }), withTiming(0, { duration: 700 })), -1));
  }, [index, t]);
  const props = useAnimatedProps(() => ({
    opacity: t.value < 0.15 ? t.value / 0.15 : 1 - Math.max(0, (t.value - 0.6) / 0.4),
    transform: [{ translateX: 5 * t.value * s * 0.2 }, { translateY: -14 * t.value * (s / 8) }],
  }));
  const g = useMemo(() => glyph(), []);
  const size = s * (0.7 + index * 0.22);
  return (
    <AnimatedG animatedProps={props}>
      <Path d={runsPath(g, '#', size, x, y)} fill={color} />
    </AnimatedG>
  );
}

/** SixFinger Code'un maskotu: altı parmaklı, uyuyan piksel bir el; üstünde süzülen üç "z". Tek renk, tema rengini alır. */
export function Mascot({ size = 168, animate = true }: { size?: number; animate?: boolean }) {
  const { c } = useTheme();
  const { width, height, grid } = CODE_MASCOT;
  const pad = 5; // sağ üstte "z" için pay (hücre)
  const cols = width + pad;
  const rows = height + 6;
  const s = size / cols;
  // Gözler ve ağız gövdedeki boşluklardır: zemin rengi kendiliğinden görünür.
  const body = useMemo(() => runsPath(grid, '#', s, 0, 6 * s), [grid, s]);
  const zx = (width - 1) * s;
  return (
    <Svg width={size} height={rows * s} viewBox={`0 0 ${size} ${rows * s}`} accessibilityLabel="SixFinger Code">
      <Path d={body} fill={c.text} />
      {animate ? (
        <>
          <Zee index={0} s={s} x={zx - 0.5 * s} y={3.4 * s} color={c.text3} />
          <Zee index={1} s={s} x={zx + 1.8 * s} y={1.6 * s} color={c.text2} />
          <Zee index={2} s={s} x={zx + 4.4 * s} y={0} color={c.text} />
        </>
      ) : (
        <Path d={runsPath(glyph(), '#', s * 0.9, zx + 1 * s, 2 * s)} fill={c.text3} />
      )}
    </Svg>
  );
}
