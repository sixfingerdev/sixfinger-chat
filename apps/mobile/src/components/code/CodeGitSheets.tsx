import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { parseUnifiedDiff, type CodeDiffDTO, type DiffFile } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { useT } from '../../lib/i18n/index.ts';
import { Sheet } from '../Sheet.tsx';
import { Press } from '../Ui.tsx';

const Title = ({ children }: { children: string }) => {
  const { c } = useTheme();
  return <RNText style={[type.label, { color: c.text3, paddingHorizontal: 22, paddingBottom: 10 }]} numberOfLines={1}>{children}</RNText>;
};

const Counts = ({ add, del }: { add: number; del: number }) => {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.success }}>+{add}</RNText>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>−{del}</RNText>
    </View>
  );
};

function FileDiff({ file, open: initial }: { file: DiffFile; open: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(initial);
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
      <Press haptics="select" scale={0.99} onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 42, backgroundColor: c.surface2 }}>
        <ChevronRight size={14} color={c.text3} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
        <RNText numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12.5, color: c.text }}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </RNText>
        <Counts add={file.additions} del={file.deletions} />
      </Press>
      {open && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: c.codeBg }}>
          <View style={{ minWidth: '100%' }}>
            {file.binary && <RNText style={[type.small, { color: c.text3, padding: 10 }]}>{t('code.diff.binary')}</RNText>}
            {file.hunks.map((h, i) => (
              <View key={i}>
                <RNText style={{ fontFamily: fonts.mono, fontSize: 11, color: c.text3, backgroundColor: c.surface2, paddingHorizontal: 10, paddingVertical: 3 }}>{h.header}</RNText>
                {h.lines.map((l, j) => (
                  <View key={j} style={{ flexDirection: 'row', backgroundColor: l.kind === 'add' ? `${c.success}1f` : l.kind === 'del' ? c.dangerSoft : undefined }}>
                    <RNText style={{ width: 34, textAlign: 'right', paddingRight: 6, fontFamily: fonts.mono, fontSize: 11, lineHeight: 18, color: c.text3 }}>{l.newNo ?? l.oldNo ?? ''}</RNText>
                    <RNText style={{ width: 14, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: l.kind === 'add' ? c.success : c.text3 }}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</RNText>
                    <RNText style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: l.kind === 'del' ? c.text2 : c.text, paddingRight: 12 }}>{l.text || ' '}</RNText>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/** Tüm farkı ya da tek dosyanın farkını gösteren alt sayfa. */
export function DiffSheet({ visible, onClose, chatId, path }: { visible: boolean; onClose: () => void; chatId: string; path?: string }) {
  const { c } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const [data, setData] = useState<CodeDiffDTO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setData(null);
    setFailed(false);
    let off = false;
    api
      .codeDiff(chatId, path)
      .then((r) => !off && setData(r))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [visible, chatId, path]);
  const files = useMemo(() => (data && !data.stale ? parseUnifiedDiff(data.diff) : []), [data]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Title>{path ?? t('code.diff.title')}</Title>
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
        {!data && !failed && <ActivityIndicator color={c.text3} style={{ paddingVertical: 28 }} />}
        {failed && <RNText style={[type.small, { color: c.text2, textAlign: 'center', paddingVertical: 28 }]}>{t('error.generic')}</RNText>}
        {data?.stale && <RNText style={[type.small, { color: c.text3, textAlign: 'center', paddingVertical: 20 }]}>{t('code.diff.stale')}</RNText>}
        {data && !data.stale && files.length === 0 && <RNText style={[type.small, { color: c.text3, textAlign: 'center', paddingVertical: 20 }]}>{t('code.diff.empty')}</RNText>}
        {files.map((f) => (
          <FileDiff key={`${f.oldPath}>${f.path}`} file={f} open={files.length <= 3} />
        ))}
        {data?.truncated && <RNText style={[type.small, { color: c.text3 }]}>{t('code.diff.truncated')}</RNText>}
      </ScrollView>
    </Sheet>
  );
}
