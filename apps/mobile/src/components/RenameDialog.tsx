import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, Text as RNText, TextInput, View } from 'react-native';
import type { ChatDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';
import { Button } from './Ui.tsx';

/** Sohbet adını değiştirmek için küçük bir iletişim kutusu. */
export function RenameDialog({ chat, onClose }: { chat: ChatDTO | null; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const [value, setValue] = useState('');
  useEffect(() => setValue(chat?.title ?? ''), [chat]);

  const save = () => {
    const v = value.trim();
    if (chat && v && v !== chat.title) void useChats.getState().renameChat(chat.id, v);
    onClose();
  };

  return (
    <Modal transparent visible={Boolean(chat)} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.overlay }}>
        <Pressable style={{ position: 'absolute', inset: 0 }} onPress={onClose} />
        <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: 20, gap: 16 }}>
          <RNText style={type.heading as never}>{t('common.rename')}</RNText>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            maxLength={120}
            selectTextOnFocus
            onSubmitEditing={save}
            returnKeyType="done"
            cursorColor={c.accent}
            selectionColor={c.accentSoft}
            style={{
              height: 48,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.lineStrong,
              backgroundColor: c.bg,
              paddingHorizontal: 14,
              fontFamily: fonts.sans,
              fontSize: 15.5,
              color: c.text,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
            <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
            <Button label={t('common.save')} onPress={save} disabled={!value.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
