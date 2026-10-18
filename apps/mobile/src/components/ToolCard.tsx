import { useState } from 'react';
import { ActivityIndicator, Text as RNText, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Check, ChevronRight, CircleAlert, Globe, Search, Wrench } from 'lucide-react-native';
import { describeTool, type MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { Press } from './Ui.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;
const ICONS = { web_search: Search, web_fetch: Globe } as const;

/** Modelin çağırdığı bir aracın katlanabilir kartı: durum, özet ve (açılınca) girdi/çıktı. */
export function ToolCard({ part }: { part: ToolPart }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { label, detail } = describeTool(part, locale);
  const Icon = ICONS[part.name as keyof typeof ICONS] ?? Wrench;
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const canOpen = !running && Boolean(part.output);
  const tone = failed ? c.danger : running ? c.accent : c.text3;

  return (
    <Animated.View
      layout={LinearTransition.duration(180)}
      style={{
        marginVertical: 6,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: failed ? c.danger : running ? c.accent : c.line,
        backgroundColor: c.surface,
        overflow: 'hidden',
      }}
    >
      <Press
        scale={0.99}
        disabled={!canOpen}
        haptics={canOpen ? 'select' : false}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12 }}
      >
        <Icon size={15} color={c.accent} />
        <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 13.5, color: c.text }}>{label}</RNText>
        <RNText numberOfLines={1} style={[type.small, { flex: 1, color: c.text3 }]}>
          {detail}
        </RNText>
        {running ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : failed ? (
          <CircleAlert size={15} color={tone} />
        ) : (
          <Check size={15} color={tone} />
        )}
        {canOpen && <ChevronRight size={14} color={c.text3} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />}
      </Press>
      {open && (
        <Animated.View entering={FadeIn.duration(160)} style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.codeBg, padding: 12, gap: 6 }}>
          {!failed && part.summary && <RNText style={[type.small, { color: c.text2 }]}>{part.summary}</RNText>}
          <RNText style={[type.label, { color: c.text3 }]}>{t('tool.input')}</RNText>
          <RNText selectable style={[type.mono, { fontSize: 12, lineHeight: 17, color: c.text2 }]}>
            {JSON.stringify(part.args, null, 2)}
          </RNText>
          <RNText style={[type.label, { color: c.text3, marginTop: 4 }]}>{t('tool.output')}</RNText>
          <RNText selectable style={[type.mono, { fontSize: 12, lineHeight: 17, color: c.text2 }]}>
            {(part.output ?? '').slice(0, 1_200)}
          </RNText>
        </Animated.View>
      )}
    </Animated.View>
  );
}
