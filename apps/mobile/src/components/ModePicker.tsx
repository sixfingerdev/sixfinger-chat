import { Text as RNText, View } from 'react-native';
import { CHAT_MODES, THINKING_LEVELS, modeSupportsThinkingLevel, type ChatMode } from '@sixfinger/shared';
import { fonts, radius, slash, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import type { Effort } from '../lib/types.ts';
import { Press } from './Ui.tsx';

export const depthOf = (m: ChatMode): 1 | 2 | 3 => (m === 'fast' ? 1 : m === 'balanced' ? 2 : 3);

/** Üç eğik çizgiden oluşan derinlik göstergesi: `level` kadarı dolu. Markanın eğik çizgi motifidir. */
export function SlashMeter({ level, color }: { level: 0 | 1 | 2 | 3; color: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 14 }}>
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{ width: 4, height: n === 1 ? 8 : n === 2 ? 11 : 14, borderRadius: 1, backgroundColor: n <= level ? color : c.lineStrong, transform: [{ skewX: slash.soft }] }}
        />
      ))}
    </View>
  );
}

/** Model satırları + eğik segmentli düşünme düzeyi kadranı. */
export function ModePicker({ mode, effort, onMode, onEffort }: { mode: ChatMode; effort: Effort; onMode: (m: ChatMode) => void; onEffort: (e: Effort) => void }) {
  const { c } = useTheme();
  const t = useT();
  const hasLevel = modeSupportsThinkingLevel(mode);

  return (
    <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
      {CHAT_MODES.map((m) => {
        const on = mode === m;
        return (
          <Press
            key={m}
            scale={0.985}
            haptics="select"
            onPress={() => onMode(m)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingLeft: 18, paddingRight: 16, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : 'transparent' }}
          >
            {on && <View style={{ position: 'absolute', left: 6, top: 12, bottom: 12, width: 3, borderRadius: 2, backgroundColor: c.accent, transform: [{ skewX: slash.soft }] }} />}
            <View style={{ flex: 1 }}>
              <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>{t(`composer.mode.${m}`)}</RNText>
              <RNText style={[type.small, { color: c.text3 }]}>{t(`composer.mode.${m}Hint`)}</RNText>
            </View>
            <SlashMeter level={depthOf(m)} color={on ? c.accent : c.text3} />
          </Press>
        );
      })}

      <View style={{ marginTop: 8, marginHorizontal: 2, paddingHorizontal: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <RNText style={[type.label, { color: c.text3 }]}>{t('composer.thinking')}</RNText>
          {hasLevel && <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.accent }}>{t(`composer.thinking.${effort}`)}</RNText>}
        </View>
        {hasLevel ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
              {THINKING_LEVELS.map((l) => {
                const on = effort === l;
                return (
                  <Press key={l} scale={0.96} haptics="select" onPress={() => onEffort(l)} style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 9, backgroundColor: on ? c.accent : c.surface2, transform: [{ skewX: slash.soft }] }} />
                    <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: on ? c.onAccent : c.text2 }}>{t(`composer.thinking.${l}`)}</RNText>
                  </Press>
                );
              })}
            </View>
            <RNText style={[type.small, { color: c.text3, marginTop: 10 }]}>{t(`composer.thinking.${effort}Hint`)}</RNText>
          </>
        ) : (
          <RNText style={[type.small, { color: c.text3 }]}>{t('composer.thinking.auto')}</RNText>
        )}
      </View>
    </View>
  );
}
