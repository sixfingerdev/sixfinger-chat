import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/index.tsx';

/** Cevap beklenirken akan turuncu eğik çizgi. */
export function WaitingLine() {
  const { c } = useTheme();
  const x = useSharedValue(-56);
  useEffect(() => {
    x.value = withRepeat(withTiming(150, { duration: 1100, easing: Easing.bezier(0.22, 1, 0.36, 1) }), -1);
  }, [x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { skewX: '-24deg' }] }));
  return (
    <View style={{ height: 4, width: 120, marginTop: 13, marginBottom: 6, overflow: 'hidden', borderRadius: 2, backgroundColor: c.surface3 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: 46, backgroundColor: c.accent }, style]} />
    </View>
  );
}

