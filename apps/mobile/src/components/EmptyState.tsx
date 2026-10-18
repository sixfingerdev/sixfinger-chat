import { useMemo } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { pickGreeting } from '@sixfinger/shared';
import { useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useLocale } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { LogoMark } from './Logo.tsx';

/** Boş sohbet: logo ve tek bir selamlama (saate ve — giriş yapmışsa — isme göre değişir). */
export function EmptyState() {
  const { c } = useTheme();
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const name = user && !user.isGuest ? user.settings.customName || user.displayName.split(' ')[0] : undefined;
  // Ekran her açıldığında yeni bir selamlama seç; yeniden çizimlerde sabit kalsın.
  const greeting = useMemo(
    () => pickGreeting({ locale, name, hour: new Date().getHours() }),
    [locale, name],
  );
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 40 }}>
      <Animated.View entering={FadeInDown.duration(420)} style={{ alignItems: 'center', gap: 20 }}>
        <LogoMark size={46} animate />
        <RNText style={[type.title, { fontSize: 28, lineHeight: 35, color: c.text, textAlign: 'center' }]}>{greeting}</RNText>
      </Animated.View>
    </View>
  );
}
