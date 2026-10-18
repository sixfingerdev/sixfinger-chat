import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text as RNText, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ArrowDown } from 'lucide-react-native';
import type { MessageDTO } from '@sixfinger/shared';
import { radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { activePath, indexMessages, versionsOf } from '../lib/tree.ts';
import { useChats } from '../store/chats.ts';
import { Composer } from './Composer.tsx';
import { EmptyState } from './EmptyState.tsx';
import { MessageItem } from './MessageItem.tsx';
import { EditDialog, MessageMenu } from './MessageSheets.tsx';
import { TopBar } from './TopBar.tsx';
import { Button, Press } from './Ui.tsx';

/** Ana sohbet ekranı: üst çubuk, ters çevrilmiş mesaj listesi ve composer. */
export function ChatScreen() {
  const { c } = useTheme();
  const t = useT();
  const chatId = useChats((s) => s.activeId) ?? undefined;
  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const loadError = useChats((s) => s.loadError);
  const loadingId = useChats((s) => s.loadingId);
  const generating = useChats((s) => s.generating);
  const [menuMsg, setMenuMsg] = useState<MessageDTO | null>(null);
  const [editMsg, setEditMsg] = useState<MessageDTO | null>(null);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<FlatList<MessageDTO>>(null);

  const idx = useMemo(() => (detail ? indexMessages(detail.messages) : null), [detail?.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (idx && detail ? activePath(idx, detail.chat.leafId) : []), [idx, detail?.chat.leafId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ters çevrilmiş liste: en yeni mesaj dizinin başında.
  const data = useMemo(() => [...path].reverse(), [path]);

  const busy = Boolean(generating);
  const showEmpty = !chatId || (detail && detail.messages.length === 0 && !generating);
  const loading = Boolean(chatId && !detail && loadingId === chatId && !loadError);
  const failed = Boolean(chatId && loadError && !detail);

  // Akış bitince hafif titreşim.
  useEffect(() => {
    if (!generating) return;
    return () => haptic.tap();
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowJump(e.nativeEvent.contentOffset.y > 420);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: MessageDTO; index: number }) => (
      <MessageItem
        msg={item}
        versions={versionsOf(idx!, item)}
        isLast={index === 0}
        live={generating?.assistantId === item.id}
        busy={busy}
        onEdit={setEditMsg}
        onMenu={setMenuMsg}
      />
    ),
    [idx, generating?.assistantId, busy],
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar chatId={chatId} />
      <View style={{ flex: 1 }}>
        {loading && (
          <View style={{ padding: 20, gap: 14 }}>
            {[62, 90, 48].map((w, i) => (
              <Animated.View key={i} entering={FadeIn.delay(i * 80)} style={{ width: `${w}%`, height: 16, borderRadius: 6, backgroundColor: c.surface2 }} />
            ))}
          </View>
        )}
        {failed && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 }}>
            <RNText style={[type.heading as never, { color: c.text }]}>{loadError === 'notfound' ? t('chat.notFound') : t('chat.loadError')}</RNText>
            {loadError === 'notfound' && <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{t('chat.notFoundHint')}</RNText>}
            <Button label={t('sidebar.newChat')} style={{ marginTop: 12 }} onPress={() => useChats.getState().newChat()} />
          </View>
        )}
        {showEmpty && !loading && !failed && <EmptyState />}
        {!showEmpty && !loading && !failed && (
          <FlatList
            ref={scrollRef}
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={9}
            // Ters çevrilmiş listede flex-end, kısa konuşmaları ekranın ÜSTÜNE yaslar (web'deki gibi);
            // uzun konuşmalarda en yeni mesaj altta kalır.
            contentContainerStyle={{ paddingVertical: 8, flexGrow: 1, justifyContent: 'flex-end' }}
            showsVerticalScrollIndicator={false}
          />
        )}
        {showJump && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', alignSelf: 'center', bottom: 12 }}>
            <JumpButton onPress={() => scrollRef.current?.scrollToOffset({ offset: 0, animated: true })} />
          </Animated.View>
        )}
      </View>
      <Composer chatId={chatId ?? null} seed={null} onChatCreated={() => {}} />
      <MessageMenu msg={menuMsg} busy={busy} onClose={() => setMenuMsg(null)} onEdit={setEditMsg} />
      <EditDialog msg={editMsg} onClose={() => setEditMsg(null)} />
    </KeyboardAvoidingView>
  );
}

function JumpButton({ onPress }: { onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Press
      haptics="tap"
      scale={0.9}
      onPress={onPress}
      style={{ width: 40, height: 40, borderRadius: radius.xl, backgroundColor: c.surface3, borderWidth: 1, borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
    >
      <ArrowDown size={18} color={c.text} />
    </Press>
  );
}
