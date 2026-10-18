import { Pressable, Text as RNText, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { useUi } from '../store/ui.ts';
import { Press } from './Ui.tsx';

/** Üst çubuğun altından kayarak gelen bildirimler; hamburger ve kişilik düğmesini örtmez, dokununca kapanır. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 80, left: 12, right: 12, gap: 8, zIndex: 100 }}>
      {toasts.map((t) => (
        <Animated.View
          key={t.id}
          entering={FadeInUp.duration(220)}
          exiting={FadeOutUp.duration(160)}
          layout={LinearTransition}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: c.surface3,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: t.kind === 'error' ? c.danger : c.lineStrong,
            paddingLeft: 14,
            paddingRight: 8,
            paddingVertical: 8,
            minHeight: 48,
            overflow: 'hidden',
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          <Pressable accessibilityLabel={t.text} onPress={() => dismiss(t.id)} style={{ position: 'absolute', inset: 0 }} />
          <View pointerEvents="none" style={{ width: 3, alignSelf: 'stretch', borderRadius: 1, backgroundColor: t.kind === 'error' ? c.danger : t.kind === 'success' ? c.success : c.accent, transform: [{ skewX: '-16deg' }] }} />
          <RNText pointerEvents="none" style={{ flex: 1, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 19, color: c.text }}>{t.text}</RNText>
          {t.action && (
            <Press
              haptics="tap"
              onPress={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              style={{ paddingHorizontal: 12, height: 34, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: c.accentSoft }}
            >
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 13, color: c.accent }}>{t.action.label}</RNText>
            </Press>
          )}
        </Animated.View>
      ))}
    </View>
  );
}
