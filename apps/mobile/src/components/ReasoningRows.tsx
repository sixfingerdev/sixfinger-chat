import { useEffect } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';
import type { MessagePartDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { formatDuration } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useUi } from '../store/ui.ts';
import { Press } from './Ui.tsx';

export type ReasoningPart = Extract<MessagePartDTO, { type: 'reasoning' }>;

/** Düşünce bloğu açık mı: elle seçilmediyse düşünürken açık, cevap/araç başlayınca kapalı. */
export const reasoningOpen = (thinking: boolean, manual: boolean | undefined) => manual ?? thinking;

/**
 * Düşünce satırı (başlık): sohbet listesinde yapışkan satırdır, yani düşünce metni uzayıp ekranda aşağı inilse bile
 * üstte kalır ve oradan kapatılabilir. `id` her düşünce parçasına özgüdür (mesaj kimliği + parça sırası).
 */
export function ReasoningHead({ id, part, thinking }: { id: string; part: ReasoningPart; thinking: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const manual = useUi((s) => s.reasoningOpen[id]);
  const open = reasoningOpen(thinking, manual);
  const rot = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(open ? 1 : 0, { duration: 200 });
  }, [open, rot]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 90}deg` }] }));
  const label = thinking ? t('msg.thinking') : part.ms ? t('msg.thoughtFor', { t: formatDuration(part.ms, locale) }) : t('msg.thought');

  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 }}>
      <Press
        scale={0.98}
        onPress={() => {
          haptic.select();
          useUi.getState().setReasoningOpen(id, !open);
        }}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30 }}
      >
        <Animated.View style={chevron}>
          <ChevronRight size={14} color={c.text3} />
        </Animated.View>
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: thinking ? c.text : c.text3 }}>{label}</RNText>
      </Press>
    </View>
  );
}

/** Düşünce metni (açıkken). Kenar çizgisi yok: yalnızca soluk metin, başlığın hizasında girintili. */
export function ReasoningBody({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingLeft: 36, paddingRight: 16, paddingBottom: 8 }}>
      <RNText selectable style={[type.small, { color: c.text3, lineHeight: 19 }]}>
        {text}
      </RNText>
    </View>
  );
}
