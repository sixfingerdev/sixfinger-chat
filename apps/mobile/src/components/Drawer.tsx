import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ease, useTheme } from '../theme/index.tsx';
import { haptic } from '../lib/haptics.ts';
import { useUi } from '../store/ui.ts';

const bezier = Easing.bezier(ease[0], ease[1], ease[2], ease[3]);
const EDGE = 28;

interface DrawerApi {
  open: () => void;
  close: () => void;
}
const Ctx = createContext<DrawerApi>({ open: () => {}, close: () => {} });
export const useDrawer = (): DrawerApi => useContext(Ctx);

/**
 * Soldan kayan kenar çekmecesi. Ekranın sol kenarından sürükleyerek açılır; açıkken her yerden sola
 * sürükleyerek ya da dışına dokunarak kapanır. İçerik hafifçe kayar, arkası kararır.
 */
export function DrawerHost({ drawer, children, enabled = true }: { drawer: ReactNode; children: ReactNode; enabled?: boolean }) {
  const { c } = useTheme();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(340, screen * 0.86);
  const p = useSharedValue(0); // 0 kapalı … 1 açık
  const start = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const setDrawer = useUi((s) => s.setDrawer);

  const settle = useCallback(
    (to: 0 | 1) => {
      p.value = withTiming(to, { duration: 260, easing: bezier });
      setOpen(to === 1);
      setDrawer(to === 1);
    },
    [p, setDrawer],
  );
  const api = useMemo<DrawerApi>(() => ({ open: () => settle(1), close: () => settle(0) }), [settle]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      settle(0);
      return true;
    });
    return () => sub.remove();
  }, [open, settle]);

  const buzz = () => haptic.tap();
  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-10, 10],
    failOffsetY: [-14, 14],
    hitSlop: open ? undefined : { left: 0, width: EDGE },
    onBegin: () => {
      start.value = p.value;
    },
    onUpdate: (e) => {
      p.value = Math.min(1, Math.max(0, start.value + e.translationX / width));
    },
    onDeactivate: (e) => {
      const fling = e.velocityX;
      const to = fling > 500 ? 1 : fling < -500 ? 0 : p.value > 0.5 ? 1 : 0;
      p.value = withTiming(to, { duration: 220, easing: bezier });
      runOnJS(setOpen)(to === 1);
      runOnJS(setDrawer)(to === 1);
      if (to !== (start.value > 0.5 ? 1 : 0)) runOnJS(buzz)();
    },
  });

  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(p.value, [0, 1], [-width, 0]) }] }));
  const content = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(p.value, [0, 1], [0, 28]) }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));

  return (
    <Ctx.Provider value={api}>
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <Animated.View style={[{ flex: 1 }, content]}>{children}</Animated.View>
          <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[{ position: 'absolute', inset: 0, backgroundColor: c.overlay }, scrim]}>
            <Pressable style={{ flex: 1 }} onPress={() => settle(0)} />
          </Animated.View>
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width,
                backgroundColor: c.bgElev,
                borderRightWidth: 1,
                borderRightColor: c.line,
              },
              panel,
            ]}
          >
            {drawer}
          </Animated.View>
        </View>
      </GestureDetector>
    </Ctx.Provider>
  );
}
