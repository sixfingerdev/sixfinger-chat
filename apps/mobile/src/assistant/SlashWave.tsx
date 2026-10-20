import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '../theme/index.tsx';

const PROFILE = [0.35, 0.6, 0.85, 1, 0.8, 0.95, 0.65, 0.5, 0.3];

function Bar({ level, k, color }: { level: SharedValue<number>; k: number; color: string }) {
  const style = useAnimatedStyle(() => ({ height: 6 + level.value * 26 * PROFILE[k]! }));
  return <Animated.View style={[{ width: 3.5, borderRadius: 2, backgroundColor: color, transform: [{ skewX: '-18deg' }] }, style]} />;
}

/** Dinlerken ses düzeyiyle oynayan eğik çizgi çubukları (SixFinger'ın "/" işaretinden). */
export function SlashWave({ level }: { level: SharedValue<number> }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4.5, height: 34 }}>
      {PROFILE.map((_, k) => (
        <Bar key={k} level={level} k={k} color={c.text} />
      ))}
    </View>
  );
}
