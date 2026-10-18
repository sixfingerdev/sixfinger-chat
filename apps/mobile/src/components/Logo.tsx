import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Svg, { G, Polygon } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { ease, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';

const AnimatedG = Animated.createAnimatedComponent(G);
const bezier = Easing.bezier(ease[0], ease[1], ease[2], ease[3]);

/** SixFinger işareti: diyagonal bir kesikle dörde bölünmüş altıgen blok. Beklerken sağ-üst ve sol-alt parçalar kayar. */
export function LogoMark({ size = 24, animate = false, color }: { size?: number; animate?: boolean; color?: string }) {
  const { c } = useTheme();
  const fill = color ?? c.text;
  const t = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withSequence(withTiming(1, { duration: 765, easing: bezier }), withTiming(0, { duration: 935, easing: bezier })),
      -1,
    );
  }, [animate, t]);

  const a = useAnimatedProps(() => ({ transform: [{ translateX: -3 * t.value }, { translateY: 2.4 * t.value }] }));
  const b = useAnimatedProps(() => ({ transform: [{ translateX: 3 * t.value }, { translateY: -2.4 * t.value }] }));

  return (
    <Svg width={size} height={(size * 116) / 63} viewBox="44 18 63 116" fill={fill} accessibilityLabel="SixFinger">
      <Polygon points="48.8,30.4 74,22.7 74,62.6 48.8,92.2" />
      <AnimatedG animatedProps={a}>
        <Polygon points="77,22.7 102.2,30.4 102.5,52.5 58.5,87 59.2,85 77,62.6" />
      </AnimatedG>
      <AnimatedG animatedProps={b}>
        <Polygon points="74.0,128.5 48.8,120.8 48.5,98.7 92.5,64.2 91.8,66.2 74.0,88.6" />
      </AnimatedG>
      <Polygon points="102.2,120.8 77.0,128.5 77.0,88.6 102.2,59.0" />
    </Svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  const { c } = useTheme();
  return <Text style={[type.wordmark, { fontSize: size, lineHeight: size + 2, color: c.text }]}>SIXFINGER</Text>;
}

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      <Wordmark />
    </View>
  );
}
