import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, Text as RNText, TextInput, View } from 'react-native';
import { Copy, Pencil, RefreshCw } from 'lucide-react-native';
import type { MessageDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { copyText } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Sheet } from './Sheet.tsx';
import { Button, Press } from './Ui.tsx';

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

/** Kullanıcı mesajını düzenleyip yeni bir sürüm olarak gönderir. */
export function EditDialog({ msg, onClose }: { msg: MessageDTO | null; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(msg?.content ?? ''), [msg]);

  const submit = () => {
    const text = draft.trim();
    if (!msg || !text) return;
    if (text === msg.content.trim()) {
      onClose();
      return;
    }
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
    <Modal transparent visible={Boolean(msg)} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'center', padding: 16, backgroundColor: c.overlay }}>
        <Pressable style={{ position: 'absolute', inset: 0 }} onPress={onClose} />
        <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: 16, gap: 14 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            cursorColor={c.accent}
            selectionColor={c.accentSoft}
            style={{
              minHeight: 110,
              maxHeight: 260,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.lineStrong,
              backgroundColor: c.bg,
              padding: 14,
              fontFamily: fonts.sans,
              fontSize: 16,
              lineHeight: 22,
              color: c.text,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
            <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
            <Button label={t('msg.editSave')} onPress={submit} disabled={!draft.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
