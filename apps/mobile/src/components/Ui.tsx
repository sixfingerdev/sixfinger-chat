import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { duration, ease, fonts, radius, slash, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { haptic } from '../lib/haptics.ts';

const bezier = Easing.bezier(ease[0], ease[1], ease[2], ease[3]);

/** Uygulamanın tüm metni: Geist, tema rengi, sistem yazı boyutu ayarına saygılı. */
export function Text({ style, tone = 'text', ...rest }: TextProps & { tone?: 'text' | 'text2' | 'text3' | 'accent' | 'danger' }) {
  const { c } = useTheme();
  return <RNText {...rest} style={[type.body, { color: c[tone] }, style]} />;
}

type PressProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Basınca küçülme oranı (0 = kapalı). */
  scale?: number;
  /** Basış anında titreşim. */
  haptics?: 'tap' | 'select' | 'press' | false;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Tüm dokunulabilir öğelerin tabanı: basınca yumuşakça küçülür, titreşim verir. */
export function Press({
  style,
  scale = 0.97,
  haptics = false,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: PressProps) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (scale) s.value = withTiming(scale, { duration: duration.fast, easing: bezier });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (scale) s.value = withTiming(1, { duration: duration.med, easing: bezier });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptics) haptic[haptics]();
        onPress?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}

type ButtonProps = Omit<PressProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  icon?: ReactNode;
  textStyle?: StyleProp<TextStyle>;
};

export function Button({ label, variant = 'primary', loading, disabled, icon, style, textStyle, ...rest }: ButtonProps) {
  const { c } = useTheme();
  const bg = { primary: c.accent, secondary: c.surface2, ghost: 'transparent', danger: c.dangerSoft }[variant];
  const fg = { primary: c.onAccent, secondary: c.text, ghost: c.text2, danger: c.danger }[variant];
  return (
    <Press
      haptics="tap"
      disabled={disabled || loading}
      {...rest}
      style={[
        {
          height: 48,
          borderRadius: radius.md,
          paddingHorizontal: 18,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: c.line,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon}
      <RNText style={[{ fontFamily: fonts.sansSemibold, fontSize: 15, color: fg }, textStyle]}>{loading ? '…' : label}</RNText>
    </Press>
  );
}

/** Web'deki eğik çizgi motifi: -16° yatık ince dikey şerit. */
export function SlashBar({ height, width = 3, color, style }: { height: number | string; width?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        { width, height: height as number, borderRadius: 1, backgroundColor: color ?? c.accent, transform: [{ skewX: slash.soft }] },
        style,
      ]}
    />
  );
}
