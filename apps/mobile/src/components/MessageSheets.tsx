import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, Text as RNText, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Copy, Pencil, RefreshCw, X } from 'lucide-react-native';
import type { MessageDTO } from '@sixfinger/shared';
import { fonts, radius, slash, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { copyText } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Sheet } from './Sheet.tsx';
import { Press } from './Ui.tsx';

/** Mesaja uzun basınca açılan eylem listesi. */
export function MessageMenu({ msg, busy, onClose, onEdit }: { msg: MessageDTO | null; busy: boolean; onClose: () => void; onEdit: (m: MessageDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const items = msg
    ? [
        {
          icon: Copy,
          label: t('msg.copy'),
          run: async () => {
            if (await copyText(msg.content)) {
              haptic.success();
              useUi.getState().toast({ kind: 'success', text: t('common.copied') });
            }
          },
        },
        ...(msg.role === 'user' ? [{ icon: Pencil, label: t('msg.edit'), disabled: busy, run: () => onEdit(msg) }] : []),
        ...(msg.role === 'assistant' ? [{ icon: RefreshCw, label: t('msg.regenerate'), disabled: busy, run: () => void useChats.getState().regenerate(msg.chatId, msg.id) }] : []),
      ]
    : [];
  return (
    <Sheet visible={Boolean(msg)} onClose={onClose}>
      <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
        {items.map((it, i) => (
          <Press
            key={i}
            scale={0.985}
            haptics="tap"
            disabled={'disabled' in it && it.disabled}
            onPress={() => {
              onClose();
              void it.run();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 12, borderRadius: radius.md, opacity: 'disabled' in it && it.disabled ? 0.4 : 1 }}
          >
            <it.icon size={19} color={c.text2} />
            <RNText style={[type.body, { color: c.text }]}>{it.label}</RNText>
          </Press>
        ))}
      </View>
    </Sheet>
  );
}

/** Kullanıcı mesajını düzenleyip yeni bir sürüm olarak gönderir: klavyenin üstünde açılan alt panel. */
export function EditDialog({ msg, onClose }: { msg: MessageDTO | null; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(msg?.content ?? ''), [msg]);

  const text = draft.trim();
  const changed = Boolean(msg) && text.length > 0 && text !== (msg?.content ?? '').trim();

  const submit = () => {
    if (!msg || !changed) return;
    haptic.tap();
    onClose();
    void useChats.getState().send({
      content: text,
      chatId: msg.chatId,
      parentId: msg.parentId,
      attachments: msg.attachments.map((a) => ({ ...a, truncated: false })),
    });
  };

  return (
    <Modal transparent visible={Boolean(msg)} animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', inset: 0, backgroundColor: c.overlay }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown.duration(260)}
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: c.line,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12) + 4,
            gap: 12,
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: 2 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: c.lineStrong }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: c.text, transform: [{ skewX: slash.soft }] }} />
            <RNText style={[type.body, { flex: 1, color: c.text, fontFamily: fonts.sansSemibold, fontSize: 17 }]}>{t('msg.editTitle')}</RNText>
            <Press accessibilityLabel={t('common.cancel')} haptics="tap" scale={0.9} hitSlop={8} onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}>
              <X size={17} color={c.text2} />
            </Press>
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            multiline
            cursorColor={c.text}
            selectionColor={c.accentSoft}
            underlineColorAndroid="transparent"
            placeholderTextColor={c.text3}
            style={{
              minHeight: 112,
              maxHeight: 230,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: focused ? c.lineStrong : c.line,
              backgroundColor: c.surface2,
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 14,
              fontFamily: fonts.sans,
              fontSize: 16,
              lineHeight: 23,
              color: c.text,
              textAlignVertical: 'top',
              // Web önizlemesinde tarayıcının odak halkası çıkmasın.
              ...({ outlineStyle: 'none' } as object),
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <RNText style={[type.small, { flex: 1, color: c.text3, lineHeight: 17 }]}>{t('msg.editHint')}</RNText>
            <Press
              haptics="tap"
              scale={0.96}
              disabled={!changed}
              onPress={submit}
              style={{ height: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, borderRadius: 23, backgroundColor: c.inverse, opacity: changed ? 1 : 0.35 }}
            >
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.onInverse }}>{t('msg.editSave')}</RNText>
              <ArrowUp size={17} color={c.onInverse} />
            </Press>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
