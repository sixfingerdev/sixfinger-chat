import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, PanResponder, Platform, Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import { fonts, useTheme } from '../../theme/index.tsx';
import { haptic } from '../../lib/haptics.ts';

const THUMB = 28;
const TRACK = 6;
const BUBBLE_H = 30;

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  /** Değeri metne çevirir (ör. "512 MB"). */
  format: (v: number) => string;
  /** Altta gösterilen işaretler (gerçek değer konumlarında). */
  marks?: number[];
  onChange: (v: number) => void;
  accessibilityLabel?: string;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Kaydırıcı: sürükleme, izin herhangi bir yerine dokunarak atlama, her adımda hafif titreşim, sürüklerken değer balonu.
 * Dikey bir ScrollView içinde çalışır: yatay hareket kaydırıcıda kalır (kaydırma ele geçirmez).
 */
export function DiskSlider({ value, min, max, step, format, marks = [], onChange, accessibilityLabel }: Props) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const originX = useRef(0);
  const track = useRef<ComponentRef<typeof View>>(null);
  const last = useRef(value);
  const w = useRef(0);
  const scale = useRef(new Animated.Value(1)).current;

  const span = Math.max(1, width - THUMB);
  const pct = (clamp(value, min, max) - min) / (max - min);
  const x = pct * span;

  const toValue = (px: number): number => {
    const ratio = clamp((px - THUMB / 2) / Math.max(1, w.current - THUMB), 0, 1);
    return clamp(Math.round((min + ratio * (max - min)) / step) * step, min, max);
  };
  const update = (px: number) => {
    const v = toValue(px);
    if (v !== last.current) {
      last.current = v;
      haptic.select();
      onChange(v);
    }
  };
  const bump = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          setDragging(true);
          bump(1.18);
          const page = e.nativeEvent.pageX;
          // Parmağın izin başlangıcına göre konumu: önce kesin ölçüm, ölçüm gelene kadar locationX.
          track.current?.measureInWindow((px: number) => {
            originX.current = px;
            update(page - px);
          });
          update(Platform.OS === 'web' ? e.nativeEvent.locationX : page - originX.current);
        },
        onPanResponderMove: (e) => update(e.nativeEvent.pageX - originX.current),
        onPanResponderRelease: () => {
          setDragging(false);
          bump(1);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          bump(1);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step, onChange],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    w.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? step : -step), min, max))}
      style={{ paddingTop: 22, paddingBottom: 34 }}
    >
      <View ref={track} onLayout={onLayout} {...pan.panHandlers} style={{ height: THUMB, justifyContent: 'center' }}>
        {/* iz */}
        <View style={{ height: TRACK, borderRadius: TRACK / 2, backgroundColor: c.surface3, marginHorizontal: THUMB / 2 }} />
        <View style={{ position: 'absolute', left: THUMB / 2, width: x, height: TRACK, borderRadius: TRACK / 2, backgroundColor: c.accent }} />
        {/* işaretler */}
        {marks.map((m) => {
          const mp = ((m - min) / (max - min)) * span + THUMB / 2;
          const on = value >= m;
          return (
            <View key={m} pointerEvents="none" style={{ position: 'absolute', left: mp - 20, width: 40, top: THUMB + 6, alignItems: 'center', gap: 4 }}>
              <View style={{ width: 2, height: 5, borderRadius: 1, backgroundColor: on ? c.accent : c.lineStrong, marginTop: -THUMB / 2 + 2 }} />
              <RNText style={{ fontFamily: fonts.sans, fontSize: 11.5, color: c.text3 }} numberOfLines={1}>
                {format(m)}
              </RNText>
            </View>
          );
        })}
        {/* değer balonu (yalnızca sürüklerken) */}
        {dragging && (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: clamp(x + THUMB / 2 - 36, 0, Math.max(0, width - 72)), width: 72, top: -BUBBLE_H - 4, height: BUBBLE_H, borderRadius: 9, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}
          >
            <RNText style={{ fontFamily: fonts.monoMedium ?? fonts.mono, fontSize: 12.5, color: c.bg }}>{format(value)}</RNText>
          </View>
        )}
        {/* tutamaç */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: x,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: c.accent,
            borderWidth: 4,
            borderColor: c.bg,
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
            transform: [{ scale }],
          }}
        />
      </View>
    </View>
  );
}
