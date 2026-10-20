import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, Text as RNText, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Expand, RotateCcw, X } from 'lucide-react-native';
import { fonts } from '../theme/index.tsx';
import { haptic } from '../lib/haptics.ts';
import { useT } from '../lib/i18n/index.ts';
import type { ScreenshotInfo } from './native.ts';

export interface RegionBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Pt {
  x: number;
  y: number;
}

const MIN = 56; // seçimin en küçük kenarı (px)
const PAD = 14;
const white = '#ffffff';

/** Tutamaç: köşeyi sürükleyerek kutuyu yeniden boyutlandırır. */
function Corner({ at, size, box }: { at: 'tl' | 'tr' | 'bl' | 'br'; size: { w: number; h: number }; box: { l: SharedNum; t: SharedNum; r: SharedNum; b: SharedNum } }) {
  const start = useSharedValue({ l: 0, t: 0, r: 0, b: 0 });
  const pan = usePanGesture({
    onBegin: () => {
      start.value = { l: box.l.value, t: box.t.value, r: box.r.value, b: box.b.value };
    },
    onUpdate: (e) => {
      const s = start.value;
      if (at === 'tl' || at === 'bl') box.l.value = Math.max(0, Math.min(s.l + e.translationX, box.r.value - MIN));
      if (at === 'tr' || at === 'br') box.r.value = Math.min(size.w, Math.max(s.r + e.translationX, box.l.value + MIN));
      if (at === 'tl' || at === 'tr') box.t.value = Math.max(0, Math.min(s.t + e.translationY, box.b.value - MIN));
      if (at === 'bl' || at === 'br') box.b.value = Math.min(size.h, Math.max(s.b + e.translationY, box.t.value + MIN));
    },
  });
  const style = useAnimatedStyle(() => ({
    left: (at === 'tl' || at === 'bl' ? box.l.value : box.r.value) - 24,
    top: (at === 'tl' || at === 'tr' ? box.t.value : box.b.value) - 24,
  }));
  const bx = at === 'tl' || at === 'bl' ? { borderLeftWidth: 4, left: 18 } : { borderRightWidth: 4, right: 18 };
  const by = at === 'tl' || at === 'tr' ? { borderTopWidth: 4, top: 18 } : { borderBottomWidth: 4, bottom: 18 };
  const radius = { borderTopLeftRadius: at === 'tl' ? 10 : 0, borderTopRightRadius: at === 'tr' ? 10 : 0, borderBottomLeftRadius: at === 'bl' ? 10 : 0, borderBottomRightRadius: at === 'br' ? 10 : 0 };
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: 'absolute', width: 48, height: 48 }, style]}>
        <View style={[{ position: 'absolute', width: 22, height: 22, borderColor: white }, bx, by, radius]} />
      </Animated.View>
    </GestureDetector>
  );
}

type SharedNum = ReturnType<typeof useSharedValue<number>>;

/**
 * Bölge seçimi: sistemin verdiği ekran görüntüsü dondurulur; parmakla serbest çizilen şekil bırakınca düzgün bir dikdörtgene dönüşür
 * (köşelerden ayarlanır, içinden taşınır). "Seç" kutuyu görüntünün yüzdesi olarak döndürür.
 */
export function RegionSelect({ shot, onConfirm, onCancel }: { shot: ScreenshotInfo; onConfirm: (box: RegionBox) => void; onCancel: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<'draw' | 'adjust'>('draw');
  const [points, setPoints] = useState<Pt[]>([]);
  const pts = useRef<Pt[]>([]);

  const bl = useSharedValue(0);
  const bt = useSharedValue(0);
  const br = useSharedValue(0);
  const bb = useSharedValue(0);
  const frame = useSharedValue(0); // 0 = yok, 1 = görünür
  const stroke = useSharedValue(1);
  const box = { l: bl, t: bt, r: br, b: bb };

  const add = useCallback((x: number, y: number) => {
    const last = pts.current[pts.current.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 3) return;
    pts.current.push({ x, y });
    setPoints(pts.current.slice());
  }, []);

  const snap = useCallback(() => {
    const p = pts.current;
    if (p.length < 3) return setPoints([]);
    let l = Infinity, tt = Infinity, r = -Infinity, b = -Infinity;
    for (const q of p) {
      l = Math.min(l, q.x);
      tt = Math.min(tt, q.y);
      r = Math.max(r, q.x);
      b = Math.max(b, q.y);
    }
    // Çok küçük ya da çok ince çizim: kutuyu en küçük boyuta büyüt (çizimin merkezinde).
    const cx = (l + r) / 2, cy = (tt + b) / 2;
    const hw = Math.max((r - l) / 2 + PAD, MIN / 2), hh = Math.max((b - tt) / 2 + PAD, MIN / 2);
    bl.value = Math.max(0, cx - hw);
    br.value = Math.min(size.w, cx + hw);
    bt.value = Math.max(0, cy - hh);
    bb.value = Math.min(size.h, cy + hh);
    haptic.success();
    setPhase('adjust');
    stroke.value = withTiming(0, { duration: 220 });
    frame.value = withSpring(1, { damping: 15, stiffness: 190 });
  }, [bl, bt, br, bb, frame, stroke, size.w, size.h]);

  const draw = usePanGesture({
    runOnJS: true,
    enabled: phase === 'draw',
    minDistance: 0,
    onBegin: (e) => {
      pts.current = [{ x: e.x, y: e.y }];
      stroke.value = 1;
      setPoints(pts.current.slice());
    },
    onUpdate: (e) => add(e.x, e.y),
    onDeactivate: () => snap(),
  });

  const sx = useSharedValue({ l: 0, t: 0, r: 0, b: 0 });
  const move = usePanGesture({
    onBegin: () => {
      sx.value = { l: bl.value, t: bt.value, r: br.value, b: bb.value };
    },
    onUpdate: (e) => {
      const s = sx.value;
      const w = s.r - s.l, h = s.b - s.t;
      const nl = Math.max(0, Math.min(s.l + e.translationX, size.w - w));
      const nt = Math.max(0, Math.min(s.t + e.translationY, size.h - h));
      bl.value = nl;
      br.value = nl + w;
      bt.value = nt;
      bb.value = nt + h;
    },
  });

  const redraw = () => {
    haptic.select();
    pts.current = [];
    setPoints([]);
    frame.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
    stroke.value = 1;
    setPhase('draw');
  };

  const confirm = () => {
    if (size.w <= 0 || size.h <= 0) return;
    haptic.tap();
    onConfirm({ l: bl.value / size.w, t: bt.value / size.h, r: br.value / size.w, b: bb.value / size.h });
  };

  const full = () => {
    haptic.tap();
    onConfirm({ l: 0, t: 0, r: 1, b: 1 });
  };

  // Seçim dışı karartma: kutunun dışındaki dört dikdörtgen.
  const dimTop = useAnimatedStyle(() => ({ left: 0, right: 0, top: 0, height: bt.value, opacity: frame.value }));
  const dimBottom = useAnimatedStyle(() => ({ left: 0, right: 0, top: bb.value, bottom: 0, opacity: frame.value }));
  const dimLeft = useAnimatedStyle(() => ({ left: 0, width: bl.value, top: bt.value, height: bb.value - bt.value, opacity: frame.value }));
  const dimRight = useAnimatedStyle(() => ({ left: br.value, right: 0, top: bt.value, height: bb.value - bt.value, opacity: frame.value }));
  const frameStyle = useAnimatedStyle(() => ({
    left: bl.value,
    top: bt.value,
    width: br.value - bl.value,
    height: bb.value - bt.value,
    opacity: frame.value,
    transform: [{ scale: 0.97 + 0.03 * frame.value }],
  }));
  const strokeStyle = useAnimatedStyle(() => ({ opacity: stroke.value }));

  const d = points.length ? `M ${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}` : '';

  const pill = (Icon: typeof Check, label: string, onPress: () => void, primary = false) => (
    <Pressable
      onPress={onPress}
      style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: primary ? white : 'rgba(20,20,22,0.82)', borderWidth: 1, borderColor: primary ? white : 'rgba(255,255,255,0.22)' }}
    >
      <Icon size={17} color={primary ? '#0b0b0c' : white} strokeWidth={2.2} />
      <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: primary ? '#0b0b0c' : white }}>{label}</RNText>
    </Pressable>
  );

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Image source={{ uri: shot.path }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="stretch" />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.30)' }} />

      <GestureDetector gesture={draw}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {/* Çizilen çizgi */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, strokeStyle]}>
            <Svg width="100%" height="100%">
              <Path d={d} stroke="rgba(0,0,0,0.38)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <Path d={d} stroke={white} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Animated.View>
        </View>
      </GestureDetector>

      {phase === 'adjust' && (
        <>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.58)' }, dimTop]} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.58)' }, dimBottom]} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.58)' }, dimLeft]} />
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.58)' }, dimRight]} />
          <GestureDetector gesture={move}>
            <Animated.View style={[{ position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 12 }, frameStyle]} />
          </GestureDetector>
          <Corner at="tl" size={size} box={box} />
          <Corner at="tr" size={size} box={box} />
          <Corner at="bl" size={size} box={box} />
          <Corner at="br" size={size} box={box} />
        </>
      )}

      {/* Üst: iptal + yönerge */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityLabel={t('common.cancel')} onPress={onCancel} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,20,22,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}>
          <X size={20} color={white} />
        </Pressable>
        {phase === 'draw' && (
          <View style={{ height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: 'rgba(20,20,22,0.82)' }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: white }}>{t('assist.select.hint')}</RNText>
          </View>
        )}
      </View>

      {/* Alt: eylemler */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 18, flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
        {phase === 'adjust' ? (
          <>
            {pill(RotateCcw, t('assist.select.redraw'), redraw)}
            {pill(Check, t('assist.select.ok'), confirm, true)}
          </>
        ) : (
          pill(Expand, t('assist.select.full'), full)
        )}
      </View>
    </View>
  );
}
