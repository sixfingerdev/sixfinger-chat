import { Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { LogoMark } from './Logo.tsx';
import { Press } from './Ui.tsx';

/** Boş sohbet: logo, selamlama ve dört öneri kartı. */
export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { c } = useTheme();
  const t = useT();
  const user = useAuth((s) => s.user);
  const first = user && !user.isGuest ? user.settings.customName || user.displayName.split(' ')[0] : '';
  const cards = [1, 2, 3, 4].map((n) => ({
    title: t(`empty.s${n}.title` as 'empty.s1.title'),
    text: t(`empty.s${n}.text` as 'empty.s1.text'),
  }));
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24, gap: 28 }}>
      <Animated.View entering={FadeInDown.duration(380)} style={{ alignItems: 'center', gap: 12 }}>
        <LogoMark size={44} animate />
        <RNText style={[type.title, { fontSize: 26, lineHeight: 32, color: c.text, textAlign: 'center' }]}>
          {first ? t('empty.greeting', { name: first }) : t('empty.greetingGuest')}
        </RNText>
        <RNText style={[type.body, { color: c.text2, textAlign: 'center', maxWidth: 320 }]}>{t('empty.sub')}</RNText>
      </Animated.View>
      <View style={{ gap: 10 }}>
        {cards.map((card, i) => (
          <Animated.View key={i} entering={FadeInDown.delay(120 + i * 60).duration(360)}>
            <Press
              haptics="tap"
              scale={0.98}
              onPress={() => onPick(card.text)}
              style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 13, gap: 3, overflow: 'hidden' }}
            >
              <RNText style={[type.label, { color: c.accent }]}>{card.title}</RNText>
              <RNText numberOfLines={2} style={[type.body, { fontSize: 14.5, lineHeight: 21, color: c.text2, fontFamily: fonts.sans }]}>
                {card.text}
              </RNText>
              <View style={{ position: 'absolute', top: -10, bottom: -10, right: 18, width: 2, backgroundColor: c.accent, opacity: 0.0, transform: [{ skewX: '-24deg' }] }} />
            </Press>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}
