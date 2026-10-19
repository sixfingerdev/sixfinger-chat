import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text as RNText, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { ArrowDown } from 'lucide-react-native';
import { messageParts, type MessageDTO, type MessagePartDTO } from '@sixfinger/shared';
import { radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useT } from '../../lib/i18n/index.ts';
import { activePath, indexMessages } from '../../lib/tree.ts';
import { useChats } from '../../store/chats.ts';
import { useUi } from '../../store/ui.ts';
import { LogoMark } from '../Logo.tsx';
import { ReasoningBody, ReasoningHead, reasoningOpen as isReasoningOpen, type ReasoningPart } from '../ReasoningRows.tsx';
import { WaitingLine } from '../WaitingLine.tsx';
import { Press } from '../Ui.tsx';
import { Mascot } from './Mascot.tsx';
import { CodeSegment, lastTodoOf, type SheetTarget } from './CodeParts.tsx';
import type { MessageActions } from './CodeCards.tsx';

type Row =
  | { key: string; kind: 'user'; msg: MessageDTO }
  | { key: string; kind: 'head'; id: string; part: ReasoningPart; thinking: boolean }
  | { key: string; kind: 'body'; part: ReasoningPart }
  | { key: string; kind: 'end' }
  | { key: string; kind: 'seg'; parts: MessagePartDTO[]; lastTodoId: string | null; isLast: boolean }
  | { key: string; kind: 'foot'; msg: MessageDTO; live: boolean };

function UserBubble({ msg }: { msg: MessageDTO }) {
  const { c } = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(220)} style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ maxWidth: '88%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderBottomRightRadius: 6, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line }}>
        <RNText selectable style={[type.body, { color: c.text }]}>
          {msg.content}
        </RNText>
      </View>
    </Animated.View>
  );
}

/** Mesajın altı: çalışırken logo animasyonu, bitince durum notu (evre ve süre alttaki durum çubuğunda). */
const CodeFooter = memo(function CodeFooter({ msg, live }: { msg: MessageDTO; live: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const streaming = live || msg.status === 'streaming';
  const hasParts = (msg.parts ?? []).length > 0;
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
      {streaming && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6 }}>
          <LogoMark size={13} animate />
        </View>
      )}
      {streaming && !hasParts && !msg.reasoning && <WaitingLine />}
      {!streaming && msg.status === 'stopped' && <RNText style={[type.small, { color: c.text3, marginTop: 6 }]}>{t('code.session.stopped')}</RNText>}
      {!streaming && msg.status === 'error' && <RNText style={[type.small, { color: c.text2, marginTop: 6 }]}>{t('code.session.failed')}</RNText>}
    </View>
  );
});

/** Code oturumunun mesaj listesi: kullanıcı balonları, düşünce satırları (yapışkan) ve Code'a özgü araç satırları. */
export function CodeThread({ chatId, onOpen, actions }: { chatId: string; onOpen: (t: SheetTarget) => void; actions?: MessageActions }) {
  const { c } = useTheme();
  const t = useT();
  const detail = useChats((s) => s.detail[chatId]);
  const generating = useChats((s) => s.generating[chatId]);
  const reasoningOpen = useUi((st) => st.reasoningOpen);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<FlatList<Row>>(null);

  const path = useMemo(() => (detail ? activePath(indexMessages(detail.messages), detail.chat.leafId) : []), [detail?.messages, detail?.chat.leafId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows, stickyKey } = useMemo(() => {
    const out: Row[] = [];
    const stick: number[] = [];
    path.forEach((m) => {
      if (m.role === 'user') {
        out.push({ key: m.id, kind: 'user', msg: m });
        return;
      }
      const live = generating?.assistantId === m.id;
      const streaming = live || m.status === 'streaming';
      const parts = messageParts(m);
      const lastTodoId = lastTodoOf(m);
      let run: MessagePartDTO[] = [];
      let runStart = 0;
      const flushRun = () => {
        if (run.length) out.push({ key: `${m.id}:s${runStart}`, kind: 'seg', parts: run, lastTodoId, isLast: m.id === path[path.length - 1]?.id });
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
      out.push({ key: `${m.id}:f`, kind: 'foot', msg: m, live });
    });
    return { rows: out, stickyKey: stick.join(',') };
  }, [path, generating?.assistantId, reasoningOpen]);
  const sticky = useMemo(() => (stickyKey ? stickyKey.split(',').map(Number) : []), [stickyKey]);

  // --- Kaydırma: yalnızca kullanıcı en alttaysa akışı takip et (sohbet ekranıyla aynı mantık) ---
  const following = useRef(true);
  const metrics = useRef({ offset: 0, content: 0, view: 0 });
  const raf = useRef(0);
  const distance = () => metrics.current.content - metrics.current.view - metrics.current.offset;
  const toEnd = useCallback((animated: boolean) => {
    if (animated) {
      scrollRef.current?.scrollToOffset({ offset: metrics.current.content, animated: true });
      return;
    }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (following.current && distance() > 1) scrollRef.current?.scrollToOffset({ offset: metrics.current.content, animated: false });
    });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const prev = metrics.current.offset;
    metrics.current = { offset: contentOffset.y, content: contentSize.height, view: layoutMeasurement.height };
    const d = distance();
    if (d <= 24) following.current = true;
    else if (contentOffset.y < prev - 1) following.current = false;
    setShowJump(d > 420);
  }, []);
  const settle = useCallback(() => {
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
  useEffect(() => {
    if (generating) following.current = true;
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (raf.current && cancelAnimationFrame(raf.current)), []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'user':
          return <UserBubble msg={item.msg} />;
        case 'head':
          return <ReasoningHead id={item.id} part={item.part} thinking={item.thinking} />;
        case 'body':
          return <ReasoningBody text={item.part.text} />;
        case 'end':
          return <View style={{ height: 1 }} />;
        case 'seg':
          return <CodeSegment chatId={chatId} parts={item.parts} lastTodoId={item.lastTodoId} onOpen={onOpen} actions={item.isLast ? actions : undefined} />;
        case 'foot':
          return <CodeFooter msg={item.msg} live={item.live} />;
      }
    },
    [chatId, onOpen, actions],
  );

  if (!detail) {
    return (
      <View style={{ padding: 20, gap: 14 }}>
        {[62, 90, 48].map((w, i) => (
          <Animated.View key={i} entering={FadeIn.delay(i * 80)} style={{ width: `${w}%`, height: 16, borderRadius: 6, backgroundColor: c.surface2 }} />
        ))}
      </View>
    );
  }
  if (!rows.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
        <Mascot size={120} />
        <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', gap: 6 }}>
          <RNText style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('code.session.ready')}</RNText>
          <RNText style={[type.small, { color: c.text2, textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{t('code.session.readyHint')}</RNText>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
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
        removeClippedSubviews={false}
        contentContainerStyle={{ paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
      />
      {showJump && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', alignSelf: 'center', bottom: 12 }}>
          <Press
            haptics="tap"
            scale={0.9}
            onPress={() => {
              following.current = true;
              toEnd(true);
            }}
            style={{ width: 40, height: 40, borderRadius: radius.xl, backgroundColor: c.surface3, borderWidth: 1, borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
          >
            <ArrowDown size={18} color={c.text} />
          </Press>
        </Animated.View>
      )}
    </View>
  );
}
