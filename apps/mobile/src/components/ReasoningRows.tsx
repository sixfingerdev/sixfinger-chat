import { useEffect } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';
import type { MessageDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { formatDuration } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useUi } from '../store/ui.ts';
import { Press } from './Ui.tsx';

/** Düşünce bloğunun durumu: düşünüyor mu, açık mı. Elle seçilmediyse düşünürken açık, cevap başlayınca kapalıdır. */
export function reasoningState(msg: MessageDTO, live: boolean, manual: boolean | undefined) {
  const streaming = live || msg.status === 'streaming';
  const thinking = streaming && msg.content.length === 0;
  return { thinking, open: manual ?? thinking };
}

/**
 * Düşünce satırı (başlık): sohbet listesinde yapışkan satırdır, yani düşünce metni uzayıp ekranda aşağı inilse bile
 * üstte kalır ve oradan kapatılabilir.
 */
export function ReasoningHead({ msg, live }: { msg: MessageDTO; live: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const manual = useUi((s) => s.reasoningOpen[msg.id]);
  const { thinking, open } = reasoningState(msg, live, manual);
  const rot = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(open ? 1 : 0, { duration: 200 });
  }, [open, rot]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 90}deg` }] }));
  const label = thinking ? t('msg.thinking') : msg.reasoningMs ? t('msg.thoughtFor', { t: formatDuration(msg.reasoningMs, locale) }) : t('msg.thought');

  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 }}>
      <Press
        scale={0.98}
        onPress={() => {
          haptic.select();
          useUi.getState().setReasoningOpen(msg.id, !open);
        }}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30 }}
      >
        <Animated.View style={chevron}>
          <ChevronRight size={14} color={c.text3} />
        </Animated.View>
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: thinking ? c.accent : c.text3 }}>{label}</RNText>
      </Press>
    </View>
  );
}

/** Düşünce metni (açıkken). */
export function ReasoningBody({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
      {/* Uzun düşüncede eğik çubuk metnin üstünden çapraz geçiyordu: düz, ince bir çizgi. */}
      <View style={{ width: 2, backgroundColor: c.line, borderRadius: 1 }} />
      <RNText selectable style={[type.small, { flex: 1, color: c.text3, lineHeight: 19 }]}>
        {text}
      </RNText>
    </Animated.View>
  );
}
