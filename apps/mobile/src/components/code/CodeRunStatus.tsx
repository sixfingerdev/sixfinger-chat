import { useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { pickStatusWord } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import type { CodeRun } from '../../store/chats.ts';

function Dot({ delay }: { delay: number }) {
  const { c } = useTheme();
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 780, easing: Easing.inOut(Easing.quad) })), -1));
  }, [delay, k]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + k.value * 0.65, transform: [{ scale: 0.7 + k.value * 0.55 }] }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }, style]} />;
}

/**
 * Ajan çalışırken composer'ın üstündeki durum çubuğu: nefes alan noktalar, geçen süre, çalışan görev sayısı ve dönen oyunlu kelime
 * ("Tinkering…", "Sixfingering…"). Sıra/hazırlık/commit/itme evrelerinde kelime yerine o evrenin adı yazılır.
 */
export function CodeRunStatus({ run, startedAt, runningTasks }: { run: CodeRun | undefined; startedAt: number; runningTasks: number }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const [word, setWord] = useState(() => pickStatusWord(locale));
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const rotate = setInterval(() => setWord((w) => pickStatusWord(locale, w)), 3_400);
    return () => {
      clearInterval(tick);
      clearInterval(rotate);
    };
  }, [locale]);

  const phase = run?.phase;
  const label = phase === 'queued' ? (run?.position ? t('code.phase.queuedPos', { n: run.position }) : t('code.phase.queued')) : phase && phase !== 'working' ? t(`code.phase.${phase}`) : word;
  const secs = Math.max(0, Math.round((now - startedAt) / 1_000));
  const [um, us] = locale === 'tr' ? ['dk', 'sn'] : ['m', 's'];
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)} ${um} ${secs % 60} ${us}` : t('code.status.sec', { s: secs });
  const txt = { fontFamily: fonts.sans, fontSize: 13.5 } as const;
  return (
    <View accessibilityRole="progressbar" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, minHeight: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 2 }}>
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
      <RNText style={[txt, { color: c.text3, fontVariant: ['tabular-nums'] }]}>{elapsed}</RNText>
      {runningTasks > 0 && (
        <>
          <RNText style={[txt, { color: c.text3 }]}>·</RNText>
          <RNText style={[txt, { color: c.text, fontFamily: fonts.sansMedium }]}>{t(runningTasks > 1 ? 'code.status.tasksMany' : 'code.status.tasks', { n: runningTasks })}</RNText>
        </>
      )}
      <RNText style={[txt, { color: c.text3 }]}>·</RNText>
      <RNText numberOfLines={1} style={[txt, { color: c.text2, flexShrink: 1 }]}>
        {label}…
      </RNText>
    </View>
  );
}
