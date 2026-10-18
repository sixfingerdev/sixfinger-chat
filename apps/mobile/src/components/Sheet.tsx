import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { duration, ease, radius, useTheme } from '../theme/index.tsx';

const bezier = Easing.bezier(ease[0], ease[1], ease[2], ease[3]);

/** Alttan açılan, aşağı sürükleyerek kapanan sayfa. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = height;
      y.value = withTiming(0, { duration: 280, easing: bezier });
    } else if (mounted) {
      y.value = withTiming(height, { duration: duration.med, easing: bezier }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onUpdate: (e) => {
      y.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      if (e.translationY > 90 || e.velocityY > 800) runOnJS(onClose)();
      else y.value = withTiming(0, { duration: duration.med, easing: bezier });
    },
  });

  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, y.value / height) }));

  if (!mounted) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: c.overlay }, scrim]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            {
              backgroundColor: c.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: c.line,
              paddingBottom: insets.bottom + 12,
              maxHeight: height * 0.88,
            },
            panel,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 8 }}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: c.lineStrong }} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
