import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Text as RNText, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, GitBranch, ListChecks, Square, X } from 'lucide-react-native';
import { BUILTIN_COMMANDS, activeMention, expandTemplate, matchCommands, parseSlash, type CodeSessionDTO, type DictKey, type SlashCommand } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useChats } from '../../store/chats.ts';
import { useCode } from '../../store/code.ts';
import { Press } from '../Ui.tsx';
import { GithubMark } from './CodeUi.tsx';

const drafts = new Map<string, string>();

/** Code oturumunun yazma alanı: slash komutları, @dosya, plan anahtarı ve ajan çalışırken mesaj kuyruğu. */
export function CodeComposer({ session, ready, focusSignal }: { session: CodeSessionDTO; ready: boolean; focusSignal: number }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const chatId = session.chatId;
  const busy = useChats((s) => Boolean(s.generating[chatId]));
  const plan = useCode((s) => s.plan[chatId] ?? false);
  const queue = useCode((s) => s.queue[chatId]) ?? [];
  const [value, setValue] = useState(() => drafts.get(chatId) ?? '');
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [repoCmds, setRepoCmds] = useState<SlashCommand[]>([]);
  const [files, setFiles] = useState<string[] | null>(null);

  useEffect(() => {
    if (focusSignal) input.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (busy) return;
    let off = false;
    api
      .codeCommands(chatId)
      .then((r) => !off && setRepoCmds(r.commands))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [chatId, busy]);

  const update = (v: string) => {
    setValue(v);
    drafts.set(chatId, v);
  };

  const all = useMemo(() => [...BUILTIN_COMMANDS, ...repoCmds.filter((x) => !BUILTIN_COMMANDS.some((b) => b.name === x.name))], [repoCmds]);
  const slashList = /^\/[\w-]*$/.test(value) ? matchCommands(all, value) : [];
  const mention = activeMention(value);

  useEffect(() => {
    if (!mention || busy) {
      setFiles(null);
      return;
    }
    let off = false;
    const h = setTimeout(() => {
      api
        .codeFiles(chatId, mention.query)
        .then((r) => !off && setFiles(r.files.slice(0, 6)))
        .catch(() => !off && setFiles([]));
    }, 150);
    return () => {
      off = true;
      clearTimeout(h);
    };
  }, [chatId, mention?.query, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = (x: SlashCommand) => (x.source === 'builtin' ? t(`code.slash.${x.name}` as DictKey) : x.description || t('code.slash.repo'));

  /** Tek bir mesajı (komut ya da düz metin) çalıştırır; ajan çalışıyorsa kuyruğa alır. */
  const dispatch = async (raw: string, planOn: boolean) => {
    const slash = parseSlash(raw);
    const cmd = slash ? all.find((x) => x.name === slash.name) : undefined;
    let content = raw;
    let usePlan = planOn;
    if (cmd && slash) {
      if (cmd.kind === 'plan') {
        useCode.getState().setPlan(chatId, !planOn || Boolean(slash.args));
        if (!slash.args) return;
        usePlan = true;
        content = slash.args;
      } else if (cmd.kind === 'pr') {
        try {
          await api.codeOpenPr(chatId);
          await useChats.getState().openChat(chatId, true);
        } catch (err) {
          reportError(err);
        }
        return;
      } else if (cmd.kind === 'compact') {
        content = '/compact';
        usePlan = false;
      } else if (cmd.template) content = expandTemplate(cmd.template, slash.args);
    }
    if (useChats.getState().generating[chatId]) {
      useCode.getState().enqueue(chatId, { text: content, plan: usePlan });
      return;
    }
    void useChats.getState().send({ content, chatId, planMode: usePlan });
  };

  const canSend = ready && Boolean(value.trim());
  const submit = () => {
    if (!canSend) return;
    haptic.tap();
    const content = value.trim();
    update('');
    drafts.delete(chatId);
    void dispatch(content, plan);
  };

  // Tur bitince kuyruktaki ilk mesaj gönderilir.
  useEffect(() => {
    if (busy) return;
    const next = useCode.getState().takeQueued(chatId);
    if (next) void useChats.getState().send({ content: next.text, chatId, planMode: next.plan });
  }, [busy, chatId, queue.length]);

  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(canSend || busy ? 1 : 0.9, { damping: 14, stiffness: 260 });
  }, [canSend, busy, scale]);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const shortRepo = session.repo.split('/')[1] ?? session.repo;
  const row = (key: string, left: string, right: string | undefined, onPress: () => void) => (
    <Press key={key} haptics="select" scale={0.985} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm }}>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>{left}</RNText>
      {!!right && (
        <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 12.5, color: c.text3 }}>
          {right}
        </RNText>
      )}
    </Press>
  );
  const popup = slashList.length > 0 ? 'slash' : mention && files ? 'mention' : null;

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
        <Press
          haptics="select"
          scale={0.95}
          accessibilityLabel={t('code.plan.mode')}
          accessibilityState={{ selected: plan }}
          hitSlop={6}
          onPress={() => useCode.getState().setPlan(chatId, !plan)}
          style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: plan ? c.accent : 'transparent', borderWidth: 1, borderColor: plan ? c.accent : c.lineStrong }}
        >
          <ListChecks size={13} color={plan ? c.onAccent : c.text2} />
          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 12.5, color: plan ? c.onAccent : c.text2 }}>{t('code.plan.toggle')}</RNText>
        </Press>
      </View>

      {popup && (
        <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 220, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface2 }} contentContainerStyle={{ padding: 4 }}>
          {popup === 'slash' && slashList.map((x) => row(x.name, `/${x.name}`, describe(x), () => { update(`/${x.name} `); input.current?.focus(); }))}
          {popup === 'mention' && files!.length === 0 && <RNText style={{ padding: 12, fontFamily: fonts.sans, fontSize: 13, color: c.text3 }}>{t('code.mention.none')}</RNText>}
          {popup === 'mention' && files!.map((f) => row(f, f, undefined, () => { update(`${value.slice(0, mention!.start)}@${f} `); setFiles(null); input.current?.focus(); }))}
        </ScrollView>
      )}

      {queue.map((q, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: c.surface3 }}>
            <RNText style={{ fontFamily: fonts.sans, fontSize: 11.5, color: c.text3 }}>{t('code.queue.title')}</RNText>
          </View>
          <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 13, color: c.text2 }}>
            {q.text}
          </RNText>
          <Press scale={0.85} accessibilityLabel={t('code.queue.remove')} hitSlop={10} onPress={() => useCode.getState().removeQueued(chatId, i)}>
            <X size={15} color={c.text3} />
          </Press>
        </View>
      ))}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: plan || focused ? c.accent : c.lineStrong, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}>
        <TextInput
          ref={input}
          value={value}
          onChangeText={update}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          placeholder={plan ? t('code.plan.modeHint') : t('code.composer.placeholder')}
          placeholderTextColor={c.text3}
          cursorColor={c.accent}
          selectionColor={c.accentSoft}
          style={[{ flex: 1, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22, color: c.text, minHeight: 36, maxHeight: 168, paddingVertical: 6, textAlignVertical: 'top' }, { outlineStyle: 'none' } as never]}
        />
        <Animated.View style={sendStyle}>
          {busy && !value.trim() ? (
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
              accessibilityLabel={busy ? t('code.queue.note') : t('composer.send')}
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
