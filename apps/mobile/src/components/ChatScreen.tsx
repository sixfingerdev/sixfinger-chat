import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text as RNText, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ArrowDown } from 'lucide-react-native';
import { messageParts, type MessageDTO, type MessagePartDTO } from '@sixfinger/shared';
import { radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { activePath, indexMessages, versionsOf } from '../lib/tree.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { ArtifactViewer } from './ArtifactViewer.tsx';
import { Composer } from './Composer.tsx';
import { EmptyState } from './EmptyState.tsx';
import { AssistantFooter, AssistantSegment, MessageItem } from './MessageItem.tsx';
import { ReasoningBody, ReasoningHead, reasoningOpen as isReasoningOpen, type ReasoningPart } from './ReasoningRows.tsx';
import { EditDialog, MessageMenu } from './MessageSheets.tsx';
import { TopBar } from './TopBar.tsx';
import { Button, Press } from './Ui.tsx';

type Row =
  | { key: string; kind: 'user'; msg: MessageDTO }
  | { key: string; kind: 'head'; id: string; part: ReasoningPart; thinking: boolean }
  | { key: string; kind: 'body'; part: ReasoningPart }
  | { key: string; kind: 'end' }
  | { key: string; kind: 'seg'; msg: MessageDTO; parts: MessagePartDTO[] }
  | { key: string; kind: 'foot'; msg: MessageDTO; live: boolean; last: boolean };

/** Ana sohbet ekranı: üst çubuk, mesaj listesi ve composer. */
export function ChatScreen() {
  const { c } = useTheme();
  const t = useT();
  const chatId = useChats((s) => s.activeId) ?? undefined;
  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const loadError = useChats((s) => s.loadError);
  const loadingId = useChats((s) => s.loadingId);
  const generating = useChats((s) => (chatId ? s.generating[chatId] : undefined));
  const [menuMsg, setMenuMsg] = useState<MessageDTO | null>(null);
  const [editMsg, setEditMsg] = useState<MessageDTO | null>(null);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<FlatList<Row>>(null);
  const reasoningOpen = useUi((st) => st.reasoningOpen);

  const idx = useMemo(() => (detail ? indexMessages(detail.messages) : null), [detail?.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (idx && detail ? activePath(idx, detail.chat.leafId) : []), [idx, detail?.chat.leafId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Asistan mesajı sıralı parçalarına göre satırlara bölünür: her düşünce parçası kendi [başlık (yapışkan)] [metin]
  // [bitiş (yapışkan, boş)] satırlarını alır; metin/araç parçaları aradaki dilimde durur. Araç sonrası yeni düşünce
  // yeni bir blok olarak aşağıda açılır. Başlık, bitiş satırı gelene kadar ekranın üstünde yapışık kalır.
  const { rows, stickyKey } = useMemo(() => {
    const out: Row[] = [];
    const stick: number[] = [];
    path.forEach((m, mi) => {
      if (m.role === 'user') {
        out.push({ key: m.id, kind: 'user', msg: m });
        return;
      }
      const live = generating?.assistantId === m.id;
      const streaming = live || m.status === 'streaming';
      const parts = messageParts(m);
      let run: MessagePartDTO[] = [];
      let runStart = 0;
      const flushRun = () => {
        if (run.length) out.push({ key: `${m.id}:s${runStart}`, kind: 'seg', msg: m, parts: run });
        run = [];
      };
      parts.forEach((p, i) => {
        if (p.type === 'reasoning') {
          flushRun();
          const rid = `${m.id}:r${i}`;
          const thinking = streaming && i === parts.length - 1;
          stick.push(out.length);
          out.push({ key: `${rid}:h`, kind: 'head', id: rid, part: p, thinking });
          if (isReasoningOpen(thinking, reasoningOpen[rid])) out.push({ key: `${rid}:b`, kind: 'body', part: p });
          stick.push(out.length);
          out.push({ key: `${rid}:e`, kind: 'end' });
        } else {
          if (!run.length) runStart = i;
          run.push(p);
        }
      });
      flushRun();
      out.push({ key: `${m.id}:f`, kind: 'foot', msg: m, live, last: mi === path.length - 1 });
    });
    return { rows: out, stickyKey: stick.join(',') };
  }, [path, generating?.assistantId, reasoningOpen]);
  // Yapışkan satır dizisinin kimliği yalnızca içeriği değişince değişir (her güncellemede yeniden kurulmasın).
  const sticky = useMemo(() => (stickyKey ? stickyKey.split(',').map(Number) : []), [stickyKey]);

  const busy = Boolean(generating);
  const showEmpty = !chatId || (detail && detail.messages.length === 0 && !generating);
  const loading = Boolean(chatId && !detail && loadingId === chatId && !loadError);
  const failed = Boolean(chatId && loadError && !detail);

  // Akış bitince hafif titreşim.
  useEffect(() => {
    if (!generating) return;
    return () => haptic.tap();
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Kaydırma: yalnızca kullanıcı en alttaysa akışı takip et ---
  // `following`: yeni içerik geldikçe en alta kaydır. Kullanıcı parmağını sürüklediği AN kapanır (programatik kaydırma
  // parmakla çatışıp titreşim yapmasın); en alta dönünce ya da "aşağı" düğmesiyle açılır.
  const following = useRef(true);
  const metrics = useRef({ offset: 0, content: 0, view: 0 });
  const raf = useRef(0);
  const distance = () => metrics.current.content - metrics.current.view - metrics.current.offset;
  const toEnd = useCallback((animated: boolean) => {
    if (animated) {
      scrollRef.current?.scrollToOffset({ offset: metrics.current.content, animated: true });
      return;
    }
    // Aynı karede gelen birden çok içerik/yerleşim değişikliği tek kaydırmaya indirgenir.
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      // `scrollToEnd` yaklaşık ölçülere dayanır; gerçek içerik yüksekliğine kaydırmak (platform sınırlar) daha güvenilir.
      if (following.current && distance() > 1) scrollRef.current?.scrollToOffset({ offset: metrics.current.content, animated: false });
    });
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const prev = metrics.current.offset;
    metrics.current = { offset: contentOffset.y, content: contentSize.height, view: layoutMeasurement.height };
    const d = distance();
    // Alta yakınsa takip açık. Uzaktaysa ve offset geriye gittiyse kullanıcı yukarı çekmiştir (web'de sürükleme olayı yok): bırak.
    if (d <= 24) following.current = true;
    else if (contentOffset.y < prev - 1) following.current = false;
    setShowJump(d > 420);
  }, []);
  const settle = useCallback(() => {
    // Parmak kalktı / kayma bitti: en alttaysak takibi geri aç.
    if (distance() <= 24) following.current = true;
  }, []);
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      metrics.current.content = h;
      if (following.current) toEnd(false);
    },
    [toEnd],
  );
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      metrics.current.view = e.nativeEvent.layout.height;
      if (following.current) toEnd(false);
    },
    [toEnd],
  );
  // Yeni bir üretim başlayınca (mesaj gönderildi) takibi aç.
  useEffect(() => {
    if (generating) following.current = true;
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'user':
          return <MessageItem msg={item.msg} versions={versionsOf(idx!, item.msg)} isLast={false} live={false} busy={busy} onEdit={setEditMsg} onMenu={setMenuMsg} />;
        case 'head':
          return <ReasoningHead id={item.id} part={item.part} thinking={item.thinking} />;
        case 'body':
          return <ReasoningBody text={item.part.text} />;
        case 'end':
          return <View style={{ height: 1 }} />;
        case 'seg':
          return <AssistantSegment msg={item.msg} parts={item.parts} onMenu={setMenuMsg} />;
        case 'foot':
          return <AssistantFooter msg={item.msg} versions={versionsOf(idx!, item.msg)} isLast={item.last} live={item.live} busy={busy} />;
      }
    },
    [idx, busy],
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
            key={chatId}
            ref={scrollRef}
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            stickyHeaderIndices={sticky}
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              following.current = false;
            }}
            onScrollEndDrag={settle}
            onMomentumScrollEnd={settle}
            onContentSizeChange={onContentSizeChange}
            onLayout={onLayout}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
            // Yapışkan başlıklar JS ile kaydırılır; kırpılan alt görünümler (Android varsayılanı) onları gizleyebilir.
            removeClippedSubviews={false}
            contentContainerStyle={{ paddingVertical: 8 }}
            showsVerticalScrollIndicator={false}
          />
        )}
        {showJump && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', alignSelf: 'center', bottom: 12 }}>
            <JumpButton
              onPress={() => {
                following.current = true;
                toEnd(true);
              }}
            />
          </Animated.View>
        )}
      </View>
      <Composer chatId={chatId ?? null} seed={null} onChatCreated={() => {}} />
      <MessageMenu msg={menuMsg} busy={busy} onClose={() => setMenuMsg(null)} onEdit={setEditMsg} />
      <EditDialog msg={editMsg} onClose={() => setEditMsg(null)} />
      <ArtifactViewer />
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
