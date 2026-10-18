import { memo } from 'react';
import { Text as RNText, View } from 'react-native';
import { ChevronRight, FileCode2, FileText, GitBranch, Image } from 'lucide-react-native';
import type { ArtifactKind } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { Press } from './Ui.tsx';
import { WaitingLine } from './WaitingLine.tsx';

const ICONS = { html: FileCode2, svg: Image, mermaid: GitBranch, markdown: FileText } as const;

/** Mesaj içinde artifact'ı temsil eden kart; dokununca tam ekran açılır. */
export const ArtifactCard = memo(function ArtifactCard({ id, title, kind, closed, size }: { id: string; title: string; kind: ArtifactKind; closed: boolean; size: number }) {
  const { c } = useTheme();
  const t = useT();
  const Icon = ICONS[kind];
  return (
    <Press
      haptics="tap"
      scale={0.98}
      onPress={() => useUi.getState().openArtifact(id)}
      style={{ marginVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: closed ? c.lineStrong : c.accent, backgroundColor: c.surface, overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={19} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text }}>
            {title}
          </RNText>
          <RNText style={[type.small, { color: c.text3 }]}>
            {t(`artifact.kind.${kind}` as 'artifact.kind.html')} · {closed ? t('artifact.ready') : `${t('artifact.writing')} ${Math.round(size / 100) / 10}k`}
          </RNText>
        </View>
        <ChevronRight size={18} color={c.text3} />
      </View>
      {!closed && (
        <View style={{ height: 2, backgroundColor: c.surface3 }}>
          <WaitingLine />
        </View>
      )}
    </Press>
  );
});
