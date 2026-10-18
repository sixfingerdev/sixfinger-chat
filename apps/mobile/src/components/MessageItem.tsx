import { memo, useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Pencil, RefreshCw, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react-native';
import type { MessageDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { copyText } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { speak, stopSpeaking } from '../lib/speech.ts';
import type { Versions } from '../lib/tree.ts';
import { useChats } from '../store/chats.ts';
import { LogoMark } from './Logo.tsx';
import { RichText } from './RichText.tsx';
import { ToolCard } from './ToolCard.tsx';
import { WaitingLine } from './WaitingLine.tsx';
import { Press } from './Ui.tsx';

export interface MessageProps {
  msg: MessageDTO;
  versions: Versions;
  isLast: boolean;
  /** Bu mesaj şu an üretiliyor. */
  live: boolean;
  /** Sohbette herhangi bir üretim sürüyor. */
  busy: boolean;
  onEdit: (msg: MessageDTO) => void;
  onMenu: (msg: MessageDTO) => void;
}

function IconBtn({ children, onPress, disabled, active, label }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; active?: boolean; label: string }) {
  const { c } = useTheme();
  return (
    <Press
      accessibilityLabel={label}
      haptics="tap"
      scale={0.88}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.accentSoft : 'transparent', opacity: disabled ? 0.35 : 1 }}
    >
      {children}
    </Press>
  );
}

function VersionNav({ versions, chatId, disabled }: { versions: Versions; chatId: string; disabled: boolean }) {
  const { c } = useTheme();
  const t = useT();
  if (versions.total < 2) return null;
  const go = (d: number) => {
    const id = versions.ids[versions.index + d];
    if (id) useChats.getState().switchVersion(chatId, id);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={t('msg.version', { i: versions.index + 1, n: versions.total })}>
      <IconBtn label={t('msg.prevVersion')} disabled={disabled || versions.index === 0} onPress={() => go(-1)}>
        <ChevronLeft size={16} color={c.text2} />
      </IconBtn>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>
        {versions.index + 1}/{versions.total}
      </RNText>
      <IconBtn label={t('msg.nextVersion')} disabled={disabled || versions.index === versions.total - 1} onPress={() => go(1)}>
        <ChevronRight size={16} color={c.text2} />
      </IconBtn>
    </View>
  );
}

function CopyBtn({ text }: { text: string }) {
  const { c } = useTheme();
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <IconBtn
      label={t('msg.copy')}
      onPress={async () => {
        if (await copyText(text)) {
          haptic.success();
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check size={16} color={c.success} /> : <Copy size={16} color={c.text2} />}
    </IconBtn>
  );
}

function UserMessage({ msg, versions, busy, onEdit, onMenu }: MessageProps) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Animated.View entering={FadeInDown.duration(220)} style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 }}>
      {msg.attachments.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
          {msg.attachments.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, maxWidth: 220 }}>
              <FileText size={14} color={c.text2} />
              <RNText numberOfLines={1} style={[type.small, { color: c.text2, flexShrink: 1 }]}>
                {a.name}
              </RNText>
            </View>
          ))}
        </View>
      )}
      <Press
        scale={0.985}
        delayLongPress={300}
        onLongPress={() => {
          haptic.press();
          onMenu(msg);
        }}
        style={{
          maxWidth: '88%',
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 20,
          borderBottomRightRadius: 6,
          backgroundColor: c.surface2,
          borderWidth: 1,
          borderColor: c.line,
        }}
      >
        <RNText selectable style={[type.body, { color: c.text }]}>
          {msg.content}
        </RNText>
      </Press>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, marginRight: -6 }}>
        <VersionNav versions={versions} chatId={msg.chatId} disabled={busy} />
        <CopyBtn text={msg.content} />
        <IconBtn label={t('msg.edit')} disabled={busy} onPress={() => onEdit(msg)}>
          <Pencil size={16} color={c.text2} />
        </IconBtn>
      </View>
    </Animated.View>
  );
}

function AssistantMessage({ msg, versions, isLast, live, busy, onMenu }: MessageProps) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [speaking, setSpeaking] = useState(false);
  const streaming = live || msg.status === 'streaming';
  const hasAnswer = msg.content.length > 0;
  const parts = msg.parts ?? [];
  const hasParts = parts.length > 0;
  const waiting = streaming && !hasAnswer && !msg.reasoning && !hasParts;

  useEffect(
    () => () => {
      if (speaking) stopSpeaking();
    },
    [speaking],
  );

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      {streaming && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <LogoMark size={13} animate />
        </View>
      )}
      <Press
        scale={1}
        delayLongPress={380}
        onLongPress={() => {
          if (!hasAnswer) return;
          haptic.press();
          onMenu(msg);
        }}
        style={{ minWidth: 0 }}
      >
        {waiting && <WaitingLine />}
        {hasParts
          ? parts.map((p, i) => (p.type === 'text' ? <RichText key={`t${i}`} text={p.text} /> : <ToolCard key={p.id} part={p} />))
          : hasAnswer && <RichText text={msg.content} />}
        {!streaming && msg.status === 'stopped' && <RNText style={[type.small, { color: c.text3, marginTop: 6 }]}>{t('msg.stopped')}</RNText>}
        {!streaming && msg.status === 'error' && (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <RNText style={[type.small, { color: c.danger }]}>{t('msg.failed')}</RNText>
            <Press haptics="tap" disabled={busy} onPress={() => void useChats.getState().regenerate(msg.chatId, msg.id)}>
              <RNText style={[type.small, { color: c.accent, fontFamily: fonts.sansSemibold }]}>{t('common.retry')}</RNText>
            </Press>
          </View>
        )}
        {!streaming && (hasAnswer || msg.status === 'error') && isLast && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginLeft: -8, flexWrap: 'wrap' }}>
            <VersionNav versions={versions} chatId={msg.chatId} disabled={busy} />
            {hasAnswer && <CopyBtn text={msg.content} />}
            {hasAnswer && (
              <>
                <IconBtn label={t('msg.good')} active={msg.feedback === 1} onPress={() => void useChats.getState().setFeedback(msg.chatId, msg.id, msg.feedback === 1 ? null : 1)}>
                  <ThumbsUp size={16} color={msg.feedback === 1 ? c.accent : c.text2} />
                </IconBtn>
                <IconBtn label={t('msg.bad')} active={msg.feedback === -1} onPress={() => void useChats.getState().setFeedback(msg.chatId, msg.id, msg.feedback === -1 ? null : -1)}>
                  <ThumbsDown size={16} color={msg.feedback === -1 ? c.accent : c.text2} />
                </IconBtn>
                <IconBtn
                  label={speaking ? t('msg.stopRead') : t('msg.read')}
                  active={speaking}
                  onPress={() => {
                    if (speaking) {
                      stopSpeaking();
                      setSpeaking(false);
                    } else {
                      setSpeaking(true);
                      speak(msg.content, locale, () => setSpeaking(false));
                    }
                  }}
                >
                  {speaking ? <Square size={15} color={c.accent} /> : <Volume2 size={16} color={c.text2} />}
                </IconBtn>
              </>
            )}
            <IconBtn label={t('msg.regenerate')} disabled={busy} onPress={() => void useChats.getState().regenerate(msg.chatId, msg.id)}>
              <RefreshCw size={16} color={c.text2} />
            </IconBtn>
          </View>
        )}
        {!streaming && !isLast && versions.total > 1 && (
          <View style={{ marginLeft: -8 }}>
            <VersionNav versions={versions} chatId={msg.chatId} disabled={busy} />
          </View>
        )}
      </Press>
    </View>
  );
}

export const MessageItem = memo(function MessageItem(props: MessageProps) {
  return props.msg.role === 'user' ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});
