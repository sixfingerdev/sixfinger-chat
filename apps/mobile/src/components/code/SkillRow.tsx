import { ActivityIndicator, Text as RNText, View } from 'react-native';
import { BookOpen, ChevronRight, CircleAlert } from 'lucide-react-native';
import type { MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { useT } from '../../lib/i18n/index.ts';
import { Press } from '../Ui.tsx';
import type { SheetTarget } from './CodeParts.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

/** Ajanın yüklediği skill: ad + kaynak; dokununca yüklenen talimat alt sayfada görünür. */
export function SkillRow({ part, onOpen }: { part: ToolPart; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const m = part.meta ?? {};
  const name = typeof m.name === 'string' ? m.name : typeof part.args.name === 'string' ? part.args.name : '';
  const file = typeof m.file === 'string' ? m.file : '';
  const source = typeof m.source === 'string' ? m.source : '';
  const running = part.status === 'running';
  const failed = part.status === 'error';
  return (
    <Press
      haptics={running ? false : 'select'}
      scale={0.985}
      disabled={running}
      onPress={() => onOpen({ kind: 'output', id: part.id })}
      style={{ marginVertical: 5, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}
    >
      {running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={16} color={c.text2} /> : <BookOpen size={17} color={c.text} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
          {t('code.skills.used')} · <RNText style={{ fontFamily: fonts.mono, fontSize: 13 }}>{name}{file ? `/${file}` : ''}</RNText>
        </RNText>
        {!!source && (
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sans, fontSize: 12, color: c.text3 }}>
            {t(`code.skills.source.${source}` as 'code.skills.source.user')}
          </RNText>
        )}
      </View>
      {!running && <ChevronRight size={15} color={c.text3} />}
    </Press>
  );
}
