import { useEffect, useRef, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ChevronRight } from 'lucide-react-native';
import { fonts, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { formatDuration } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { Press } from './Ui.tsx';

/** Modelin "düşünme" notları: akarken açık, cevap başlayınca kendiliğinden kapanır. */
export function ReasoningBlock({ text, streaming, hasAnswer, ms }: { text: string; streaming: boolean; hasAnswer: boolean; ms: number | null }) {
  const { c } = useTheme();
  const t = useT();
  const thinking = streaming && !hasAnswer;
  const [open, setOpen] = useState(thinking);
  const touched = useRef(false);
  const rot = useSharedValue(thinking ? 1 : 0);

  useEffect(() => {
    if (touched.current) return;
    setOpen(thinking);
  }, [thinking]);
  useEffect(() => {
    rot.value = withTiming(open ? 1 : 0, { duration: 200 });
  }, [open, rot]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 90}deg` }] }));

  if (!text) return null;
  const label = thinking ? t('msg.thinking') : ms ? t('msg.thoughtFor', { t: formatDuration(ms) }) : t('msg.thought');

  return (
    <Animated.View layout={LinearTransition.duration(200)} style={{ marginBottom: 8 }}>
      <Press
        scale={0.98}
        onPress={() => {
          touched.current = true;
          haptic.select();
          setOpen((o) => !o);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30 }}
      >
        <Animated.View style={chevron}>
          <ChevronRight size={14} color={c.text3} />
        </Animated.View>
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: thinking ? c.accent : c.text3 }}>{label}</RNText>
      </Press>
      {open && (
        <Animated.View entering={FadeIn.duration(180)} style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <View style={{ width: 2, backgroundColor: c.line, borderRadius: 1, transform: [{ skewX: '-16deg' }] }} />
          <RNText selectable style={[type.small, { flex: 1, color: c.text3, lineHeight: 19 }]}>
            {text}
          </RNText>
        </Animated.View>
      )}
    </Animated.View>
  );
}
