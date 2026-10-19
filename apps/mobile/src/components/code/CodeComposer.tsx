import { useEffect, useState } from 'react';
import { Text as RNText, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, GitBranch, Square } from 'lucide-react-native';
import type { CodeSessionDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useChats } from '../../store/chats.ts';
import { Press } from '../Ui.tsx';
import { GithubMark } from './CodeUi.tsx';

const drafts = new Map<string, string>();

/** Code oturumunun yazma alanı: üstte "repo ⎇ branch" ve +N −M değişiklik çipi, altta girdi ve gönder/durdur. */
export function CodeComposer({ session, ready, onChanges }: { session: CodeSessionDTO; ready: boolean; onChanges: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const chatId = session.chatId;
  const busy = useChats((s) => Boolean(s.generating[chatId]));
  const [value, setValue] = useState(() => drafts.get(chatId) ?? '');
  const [focused, setFocused] = useState(false);

  const update = (v: string) => {
    setValue(v);
    drafts.set(chatId, v);
  };
  const canSend = ready && !busy && Boolean(value.trim());
  const submit = () => {
    if (!canSend) return;
    haptic.tap();
    void useChats.getState().send({ content: value.trim(), chatId });
    update('');
    drafts.delete(chatId);
  };

  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(canSend || busy ? 1 : 0.9, { damping: 14, stiffness: 260 });
  }, [canSend, busy, scale]);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const shortRepo = session.repo.split('/')[1] ?? session.repo;
  const changed = session.filesChanged > 0 || session.additions + session.deletions > 0;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 6, gap: 8, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, minHeight: 28 }}>
        <GithubMark size={14} color={c.text3} />
        <RNText numberOfLines={1} style={{ flexShrink: 0, maxWidth: '38%', fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>
          {shortRepo}
        </RNText>
        <GitBranch size={13} color={c.text3} />
        <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
          {session.workBranch}
        </RNText>
        {changed && (
          <Press
            haptics="select"
            scale={0.95}
            onPress={onChanges}
            accessibilityLabel={t('code.changes')}
            hitSlop={6}
            style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line }}
          >
            <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.success }}>+{session.additions}</RNText>
            <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>−{session.deletions}</RNText>
            {!!session.headSha && session.headSha !== session.pushedSha && <View accessibilityLabel={t('code.pr.unpushed')} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warning }} />}
          </Press>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: focused ? c.accent : c.lineStrong, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}>
        <TextInput
          value={value}
          onChangeText={update}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          placeholder={t('code.composer.placeholder')}
          placeholderTextColor={c.text3}
          cursorColor={c.accent}
          selectionColor={c.accentSoft}
          style={[{ flex: 1, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22, color: c.text, minHeight: 36, maxHeight: 168, paddingVertical: 6, textAlignVertical: 'top' }, { outlineStyle: 'none' } as never]}
        />
        <Animated.View style={sendStyle}>
          {busy ? (
            <Press
              scale={0.9}
              accessibilityLabel={t('composer.stop')}
              onPress={() => {
                haptic.press();
                useChats.getState().stop(chatId);
              }}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Square size={14} color={c.onAccent} fill={c.onAccent} />
            </Press>
          ) : (
            <Press
              scale={0.9}
              accessibilityLabel={t('composer.send')}
              disabled={!canSend}
              onPress={submit}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: canSend ? c.inverse : c.surface3, alignItems: 'center', justifyContent: 'center' }}
            >
              <ArrowUp size={19} strokeWidth={2.5} color={canSend ? c.onInverse : c.text3} />
            </Press>
          )}
        </Animated.View>
      </View>
    </View>
  );
}
