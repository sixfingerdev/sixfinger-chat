import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text as RNText, TextInput, View, useWindowDimensions } from 'react-native';
import * as Speech from 'expo-speech';
import { router } from 'expo-router';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, ArrowUpRight, Check, Copy, Mic, ScanText, Square, SquarePen, Volume2, X, Zap } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { copyText } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { selectPath, useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { LogoMark } from '../components/Logo.tsx';
import { WaitingLine } from '../components/WaitingLine.tsx';
import { Markdown } from '../components/markdown/Markdown.tsx';
import { readAutoVoice, readSpeakPref } from './prefs.ts';
import { SlashWave } from './SlashWave.tsx';
import { appName, assistantNative, type AssistContext } from './native.ts';
import { useSpeech } from './useSpeech.ts';

/** Sesli okumak için Markdown işaretlerini ve kod bloklarını sadeleştirir. */
function plainSpeech(md: string, codeWord: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ` ${codeWord} `)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Güç tuşu/kaydırma ("assistant", "assist") ve karo (voice) dinleyerek açılır; "Şimdi dene" yazıyla başlar. Ayarlardan kapatılabilir. */
const wantsVoice = (source: string, voice: boolean): boolean => voice || ((source === 'assistant' || source === 'assist') && readAutoVoice());

const chipBase = { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 } as const;

/**
 * Asistan penceresi: diğer uygulamanın üstünde alttan çıkan "dock". Yazarak ya da sesle sor, ekrandaki içeriği ekle,
 * yanıtı kartta izle/dinle, istersen sohbette aç. Kapatınca sunucudaki üretim sürer.
 */
export function AssistantPanel() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const config = useUi((s) => s.config);
  const user = useAuth((s) => s.user);

  const [launch, setLaunch] = useState(() => assistantNative?.getLaunchInfo() ?? { source: 'app', voice: false });
  const [ctx, setCtx] = useState<AssistContext | null>(() => assistantNative?.getAssistContext() ?? null);
  const [withScreen, setWithScreen] = useState(false);
  const [text, setText] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [hint, setHint] = useState('');
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const awaiting = useRef<{ voice: boolean } | null>(null);

  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const generating = useChats((s) => Boolean(chatId && s.generating[chatId]));
  const path = useMemo(() => selectPath(detail), [detail]);
  const answer = [...path].reverse().find((m) => m.role === 'assistant');
  const question = [...path].reverse().find((m) => m.role === 'user');
  const speechLang = locale === 'tr' ? 'tr-TR' : 'en-US';

  // ---- giriş / kapanış animasyonu ----
  const enter = useSharedValue(0);
  const drag = useSharedValue(0);
  const kb = useReanimatedKeyboardAnimation();
  useEffect(() => {
    enter.value = withTiming(1, { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  }, [enter]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: enter.value * Math.max(0, 1 - drag.value / 320) }));
  const dockStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: kb.height.value + drag.value + (1 - enter.value) * 46 }],
  }));

  const stopSpeaking = useCallback(() => {
    void Speech.stop();
    setSpeaking(false);
  }, []);

  const speech = useSpeech(
    speechLang,
    (spoken) => void submit(spoken, { voice: true }),
    (key) => setHint(t(key)),
  );

  const close = useCallback(() => {
    speech.cancel();
    stopSpeaking();
    enter.value = withTiming(0, { duration: 140 });
    setTimeout(() => assistantNative?.close(), 130);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter, stopSpeaking]);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onUpdate: (e) => {
      drag.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      if (e.translationY > 90 || e.velocityY > 800) close();
      else drag.value = withTiming(0, { duration: 180 });
    },
  });

  // ---- sistem olayları: yeni oturum (aynı pencere yeniden açıldı), ekran içeriği ----
  useEffect(() => {
    if (!assistantNative) return;
    const a = assistantNative.addListener('onAssistContext', (e) => setCtx(e));
    const b = assistantNative.addListener('onSession', (e) => {
      setLaunch({ source: e.source, voice: e.voice });
      setCtx(null);
      setWithScreen(false);
      setChatId(null);
      setText('');
      setHint('');
      awaiting.current = null;
      stopSpeaking();
      enter.value = withTiming(1, { duration: 280 });
      if (wantsVoice(e.source, e.voice)) void speech.start();
    });
    return () => {
      a.remove();
      b.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Karo / "sesle sor" ile açıldıysa dinlemeye hemen başla.
  useEffect(() => {
    if (wantsVoice(launch.source, launch.voice)) void speech.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (speech.state !== 'idle') speech.cancel();
      else close();
      return true;
    });
    return () => sub.remove();
  }, [close, speech]);

  // ---- yanıtı sesli oku (tercihe göre) ----
  useEffect(() => {
    if (!awaiting.current || !answer || answer.status === 'streaming') return;
    const pending = awaiting.current;
    awaiting.current = null;
    if (answer.status !== 'complete' || !answer.content.trim()) return;
    const pref = readSpeakPref();
    if (pref === 'off' || (pref === 'auto' && !pending.voice)) return;
    setSpeaking(true);
    Speech.speak(plainSpeech(answer.content, t('assist.codeBlock')), {
      language: speechLang,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, [answer, speechLang, t]);

  // ---- gönder ----
  async function submit(raw: string, opts: { voice?: boolean; screen?: boolean } = {}) {
    const q = raw.trim();
    if (!q || generating) return;
    setHint('');
    stopSpeaking();
    let content = q;
    let attachments: Array<{ name: string; mime: string; text: string; truncated: boolean }> | undefined;
    if ((opts.screen || withScreen) && ctx?.text) {
      const body = `${t('assist.screenOf', { app: appName(ctx.packageName) })}${ctx.url ? `\n${ctx.url}` : ''}\n\n${ctx.text}`;
      if (config?.limits.features.attachments) attachments = [{ name: 'ekran.txt', mime: 'text/plain', text: body, truncated: ctx.truncated }];
      else content = `${q}\n\n---\n${body}`.slice(0, config?.limits.maxMessageChars ?? 4000);
      setWithScreen(true);
    }
    setText('');
    awaiting.current = { voice: Boolean(opts.voice) };
    haptic.tap();
    await useChats.getState().send({ content, attachments, chatId, mode: deep ? 'deep' : 'fast', onChatCreated: setChatId });
  }

  const newConversation = () => {
    stopSpeaking();
    awaiting.current = null;
    setChatId(null);
    setText('');
    setHint('');
    haptic.tap();
  };

  const openInApp = () => {
    if (!chatId) return;
    stopSpeaking();
    void useChats.getState().openChat(chatId);
    try {
      router.replace('/');
    } catch {
      /* ana uygulamanın gezinmesi henüz hazır değil: açılışta etkin sohbet gösterilir */
    }
    assistantNative?.openApp();
    assistantNative?.close();
  };

  const copyAnswer = async () => {
    if (!answer?.content) return;
    if (await copyText(answer.content)) {
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 1400);
    }
  };

  // ---- görünüm ----
  const listening = speech.state !== 'idle';
  const canSend = text.trim().length > 0;
  const loggedOut = !user;
  const quick = ctx?.text
    ? [t('assist.q.summarize'), t('assist.q.points'), t('assist.q.reply'), t('assist.q.translate')]
    : [];
  const showCard = Boolean(chatId && (answer || question));

  const iconBtn = (Icon: typeof Copy, label: string, onPress: () => void, tone: 'text2' | 'text' = 'text2') => (
    <Pressable accessibilityLabel={label} hitSlop={8} onPress={onPress} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={18} color={tone === 'text' ? c.text : c.text2} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay }, scrimStyle]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel={t('common.close')} />
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingBottom: insets.bottom + 10, gap: 8 }, dockStyle]} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 2 }}>
            <View style={{ width: 34, height: 5, borderRadius: 2, backgroundColor: c.text3, opacity: 0.7, transform: [{ skewX: '-24deg' }] }} />
          </View>
        </GestureDetector>

        {/* Yanıt kartı */}
        {showCard && (
          <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.lineStrong, overflow: 'hidden', maxHeight: height * 0.5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingTop: 10 }}>
              <LogoMark size={18} />
              <RNText style={[type.label, { flex: 1, color: c.text3 }]} numberOfLines={1}>
                {question?.content ? question.content.split('\n')[0] : 'SixFinger'}
              </RNText>
              {speaking && iconBtn(Volume2, t('assist.stopSpeaking'), stopSpeaking, 'text')}
              {iconBtn(copied ? Check : Copy, t('common.copy'), () => void copyAnswer())}
              {iconBtn(ArrowUpRight, t('assist.openInApp'), openInApp)}
              {iconBtn(SquarePen, t('assist.newConversation'), newConversation)}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {question?.attachments?.length ? (
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: c.surface2 }}>
                  <ScanText size={13} color={c.text2} />
                  <RNText style={[type.small, { color: c.text2 }]}>{t('assist.screenAttached')}</RNText>
                </View>
              ) : null}
              {answer?.status === 'error' ? (
                <RNText style={[type.body, { color: c.danger, paddingTop: 10 }]}>{t('assist.err.chat')}</RNText>
              ) : answer?.content ? (
                <View style={{ paddingTop: 6 }}>
                  <Markdown text={answer.content} />
                </View>
              ) : (
                <WaitingLine />
              )}
            </ScrollView>
          </View>
        )}

        {/* Ekran bağlamı + hızlı eylemler */}
        {ctx?.text ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
            <Pressable
              onPress={() => {
                haptic.select();
                setWithScreen((v) => !v);
              }}
              style={[chipBase, { borderColor: withScreen ? c.text : c.lineStrong, backgroundColor: withScreen ? c.text : c.surface }]}
            >
              {withScreen ? <Check size={14} color={c.bg} /> : <ScanText size={14} color={c.text2} />}
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: withScreen ? c.bg : c.text2 }}>{t('assist.screen', { app: appName(ctx.packageName) })}</RNText>
            </Pressable>
            {quick.map((q) => (
              <Pressable key={q} disabled={generating} onPress={() => void submit(q, { screen: true })} style={[chipBase, { borderColor: c.lineStrong, backgroundColor: c.surface, opacity: generating ? 0.5 : 1 }]}>
                <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text }}>{q}</RNText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {!!hint && <RNText style={[type.small, { color: c.text2, paddingHorizontal: 8 }]}>{hint}</RNText>}

        {/* Yazı / ses alanı */}
        {loggedOut ? (
          <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.lineStrong, padding: 16 }}>
            <RNText style={[type.body, { color: c.text2 }]}>{t('assist.signIn')}</RNText>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, minHeight: 56, backgroundColor: c.surface, borderRadius: 28, borderWidth: 1, borderColor: c.lineStrong, paddingLeft: 8, paddingRight: 8, paddingVertical: 7 }}>
            {!listening && (
              <Pressable
                accessibilityLabel={t('assist.mode')}
                onPress={() => {
                  haptic.select();
                  setDeep((v) => !v);
                }}
                style={{ height: 42, paddingHorizontal: 11, borderRadius: 21, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.surface2 }}
              >
                <Zap size={15} color={deep ? c.text3 : c.text} fill={deep ? 'none' : c.text} />
                <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{deep ? t('composer.mode.deep') : t('composer.mode.fast')}</RNText>
              </Pressable>
            )}
            {listening ? (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 42, paddingLeft: 10 }}>
                <SlashWave level={speech.level} />
                <RNText numberOfLines={2} style={[type.body, { flex: 1, color: speech.partial ? c.text : c.text3 }]}>
                  {speech.partial || (speech.state === 'starting' ? t('assist.starting') : t('assist.listening'))}
                </RNText>
              </View>
            ) : (
              <TextInput
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  if (hint) setHint('');
                }}
                placeholder={t('assist.placeholder')}
                placeholderTextColor={c.text3}
                cursorColor={c.accent}
                selectionColor={c.accentSoft}
                multiline
                returnKeyType="send"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={() => void submit(text)}
                style={{ flex: 1, maxHeight: 112, minHeight: 42, paddingVertical: 10, paddingHorizontal: 6, fontFamily: fonts.sans, fontSize: 16, color: c.text }}
              />
            )}
            {generating ? (
              <Pressable accessibilityLabel={t('composer.stop')} onPress={() => chatId && useChats.getState().stop(chatId)} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text }}>
                <Square size={14} color={c.bg} fill={c.bg} />
              </Pressable>
            ) : listening ? (
              <Pressable accessibilityLabel={t('composer.stop')} onPress={speech.stop} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text }}>
                <Square size={14} color={c.bg} fill={c.bg} />
              </Pressable>
            ) : canSend ? (
              <Pressable accessibilityLabel={t('composer.send')} onPress={() => void submit(text)} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text }}>
                <ArrowUp size={20} color={c.bg} strokeWidth={2.4} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel={t('assist.voice')}
                onPress={() => {
                  haptic.tap();
                  stopSpeaking();
                  void speech.start();
                }}
                style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}
              >
                <Mic size={19} color={c.text} />
              </Pressable>
            )}
            {!listening && !generating && showCard && iconBtn(X, t('common.close'), close)}
          </View>
        )}
      </Animated.View>
    </View>
  );
}
