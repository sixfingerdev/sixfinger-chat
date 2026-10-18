import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Text as RNText, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowUp, Brain, Check, FileText, Lock, Paperclip, Square, X } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import type { Effort, PendingAttachment } from '../lib/types.ts';
import { timeUntil } from '../lib/format.ts';
import { pickTextFiles } from '../lib/files.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Sheet } from './Sheet.tsx';
import { Press } from './Ui.tsx';

const drafts = new Map<string, string>();

export function Composer({ chatId, onChatCreated, seed }: { chatId: string | null; onChatCreated: (id: string) => void; seed: { text: string; n: number } | null }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const config = useUi((s) => s.config);
  const effort = useUi((s) => s.effort);
  const setEffort = useUi((s) => s.setEffort);
  const generating = useChats((s) => s.generating);
  const prefill = useUi((s) => s.prefill);
  const draftKey = chatId ?? 'new';

  const [value, setValue] = useState(() => drafts.get(draftKey) ?? '');
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [effortOpen, setEffortOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const limits = config?.limits;
  const maxChars = limits?.maxMessageChars ?? 4_000;
  const canAttach = Boolean(limits?.features.attachments);
  const busy = Boolean(generating);
  const remaining = config ? Math.max(0, config.usage.limit - config.usage.used) : null;

  useEffect(() => {
    setValue(drafts.get(draftKey) ?? '');
    setFiles([]);
  }, [draftKey]);
  useEffect(() => {
    if (seed) {
      setValue(seed.text);
      input.current?.focus();
    }
  }, [seed]);

  useEffect(() => {
    if (prefill) {
      setValue(prefill.text);
      drafts.set(draftKey, prefill.text);
      input.current?.focus();
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (v: string) => {
    setValue(v);
    drafts.set(draftKey, v);
  };

  const lockedNotice = () => {
    const ui = useUi.getState();
    if (user?.isGuest) {
      ui.toast({ kind: 'info', text: t('limits.title'), action: { label: t('limits.upgrade'), run: () => router.push({ pathname: '/auth', params: { mode: 'register' } }) } });
    } else {
      ui.toast({ kind: 'info', text: t('composer.attachLocked'), action: { label: t('limits.verify'), run: () => router.push({ pathname: '/auth', params: { mode: 'verify' } }) } });
    }
  };

  const attach = async () => {
    if (!canAttach) return lockedNotice();
    const ui = useUi.getState();
    const room = (limits?.maxAttachments ?? 0) - files.length;
    if (room <= 0) return ui.toast({ kind: 'info', text: t('composer.attachMax', { n: limits?.maxAttachments ?? 0 }) });
    const results = await pickTextFiles(room);
    const next: PendingAttachment[] = [];
    for (const r of results) {
      if (!r.ok) {
        ui.toast({ kind: 'error', text: t('composer.attachUnsupported', { name: r.name }) });
        continue;
      }
      if (r.file.truncated) ui.toast({ kind: 'info', text: t('composer.attachTooBig', { name: r.file.name, n: r.file.text.length }) });
      next.push(r.file);
    }
    if (next.length) setFiles((cur) => [...cur, ...next]);
  };

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    if (text.length > maxChars) return useUi.getState().toast({ kind: 'error', text: t('composer.tooLong') });
    haptic.tap();
    void useChats.getState().send({ content: text, attachments: files, chatId, onChatCreated });
    update('');
    drafts.delete(draftKey);
    setFiles([]);
  };

  const efforts: Array<{ id: Effort; label: string; hint: string }> = [
    { id: 'low', label: t('composer.effort.low'), hint: t('composer.effort.lowHint') },
    { id: 'medium', label: t('composer.effort.medium'), hint: t('composer.effort.mediumHint') },
    { id: 'high', label: t('composer.effort.high'), hint: t('composer.effort.highHint') },
  ];
  const currentEffort = efforts.find((e) => e.id === effort) ?? efforts[1]!;
  const over = value.length > maxChars;
  const showCounter = value.length > maxChars * 0.8;
  const lowQuota = remaining !== null && (user?.isGuest || remaining <= 5);
  const canSend = Boolean(value.trim()) && !over && !busy;

  // Gönder/durdur düğmesi: etkinleşince hafifçe büyür.
  const sendScale = useSharedValue(1);
  useEffect(() => {
    sendScale.value = withSpring(canSend || busy ? 1 : 0.9, { damping: 14, stiffness: 260 });
  }, [canSend, busy, sendScale]);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.value }] }));
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withTiming(focused ? 1 : 0, { duration: 160 });
  }, [focused, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8) + 2, paddingTop: 6, backgroundColor: c.bg }}>
      <View style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.lineStrong }}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', inset: -1, borderRadius: 24, borderWidth: 1.5, borderColor: c.accent }, ringStyle]} />
        {files.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 12 }}>
            {files.map((f, i) => (
              <View key={`${f.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingLeft: 10, paddingRight: 4, borderRadius: radius.sm, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, maxWidth: 230 }}>
                <FileText size={14} color={c.text2} />
                <RNText numberOfLines={1} style={[type.small, { color: c.text, flexShrink: 1 }]}>
                  {f.name}
                </RNText>
                <Press scale={0.85} haptics="tap" onPress={() => setFiles((cur) => cur.filter((_, j) => j !== i))} hitSlop={8} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                  <X size={13} color={c.text2} />
                </Press>
              </View>
            ))}
          </View>
        )}
        <TextInput
          ref={input}
          value={value}
          onChangeText={update}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          placeholder={user?.isGuest ? t('composer.placeholderGuest') : t('composer.placeholder')}
          placeholderTextColor={c.text3}
          cursorColor={c.accent}
          selectionColor={c.accentSoft}
          style={{ fontFamily: fonts.sans, fontSize: 16, lineHeight: 22, color: c.text, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 4, maxHeight: 168, minHeight: 46, textAlignVertical: 'top' }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Press
              accessibilityLabel={canAttach ? t('composer.attach') : t('composer.attachLocked')}
              haptics="tap"
              scale={0.88}
              onPress={() => void attach()}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
            >
              {canAttach ? <Paperclip size={20} color={c.text2} /> : <Lock size={17} color={c.text3} />}
            </Press>
            <Press
              haptics="select"
              scale={0.95}
              onPress={() => setEffortOpen(true)}
              style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 17, backgroundColor: c.surface2 }}
            >
              <Brain size={15} color={c.text2} />
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{currentEffort.label}</RNText>
            </Press>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {showCounter && <RNText style={{ fontFamily: fonts.mono, fontSize: 11.5, color: over ? c.danger : c.text3 }}>{t('composer.chars', { n: value.length, max: maxChars })}</RNText>}
            <Animated.View style={sendStyle}>
              {busy ? (
                <Press scale={0.9} accessibilityLabel={t('composer.stop')} onPress={() => { haptic.press(); useChats.getState().stop(); }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
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
      </View>
      <View style={{ alignItems: 'center', paddingTop: 6, minHeight: 22 }}>
        {lowQuota && config ? (
          <RNText style={[type.small, { fontSize: 12, color: remaining === 0 ? c.danger : c.text3 }]}>
            {t('composer.remaining', { n: remaining ?? 0 })}
            {remaining === 0 ? ` · ${t('composer.remainingReset', { time: timeUntil(config.usage.resetsAt, locale) })}` : ''}
          </RNText>
        ) : (
          <RNText style={[type.small, { fontSize: 12, color: c.text3 }]}>{t('composer.disclaimer')}</RNText>
        )}
      </View>

      <Sheet visible={effortOpen} onClose={() => setEffortOpen(false)}>
        <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
          <RNText style={[type.label, { color: c.text3, paddingHorizontal: 12, paddingBottom: 8 }]}>{t('composer.effort')}</RNText>
          {efforts.map((e) => (
            <Press
              key={e.id}
              scale={0.985}
              haptics="select"
              onPress={() => {
                setEffort(e.id);
                setEffortOpen(false);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: effort === e.id ? c.accentSoft : 'transparent' }}
            >
              <View style={{ flex: 1 }}>
                <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>{e.label}</RNText>
                <RNText style={[type.small, { color: c.text3 }]}>{e.hint}</RNText>
              </View>
              {effort === e.id && <Check size={18} color={c.accent} />}
            </Press>
          ))}
        </View>
      </Sheet>
    </View>
  );
}
