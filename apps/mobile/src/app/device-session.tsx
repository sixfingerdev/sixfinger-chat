import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text as RNText, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Square } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import type { LinkDetail, LinkMessage, LinkPart } from '../lib/link.ts';
import { useT } from '../lib/i18n/index.ts';
import { Button, Press } from '../components/Ui.tsx';
import { CodeHeader } from '../components/code/CodeUi.tsx';

function PartView({ p }: { p: LinkPart }) {
  const { c } = useTheme();
  const box = { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: 10, backgroundColor: c.surface, gap: 4 } as const;
  if (p.type === 'text') return <RNText selectable style={[type.body, { color: c.text }]}>{p.text}</RNText>;
  if (p.type === 'reasoning') return <RNText style={[type.small, { color: c.text3 }]}>{p.text}</RNText>;
  if (p.type === 'tool')
    return (
      <View style={box}>
        <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 13, color: c.text }}>
          {p.tool} · {p.status}
          {p.title ? `  ${p.title}` : ''}
        </RNText>
        {!!p.input && <RNText numberOfLines={4} style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>{p.input}</RNText>}
        {!!p.output && <RNText numberOfLines={8} style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>{p.output}</RNText>}
      </View>
    );
  if (p.type === 'patch') return <RNText style={[type.small, { color: c.text3 }]}>± {(p.files ?? []).join(', ')}</RNText>;
  if (p.type === 'file') return <RNText style={[type.small, { color: c.text3 }]}>📎 {p.filename}</RNText>;
  // CLI'da yeni bir parça türü olabilir: genel satır
  return <RNText style={[type.small, { color: c.text3 }]}>[{p.type}] {p.title || p.text || p.tool || ''}</RNText>;
}

/** Cihazdaki bir oturumu izle ve yönet (2 sn'de bir yenilenir). */
export default function DeviceSession() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { deviceId = '', id = '' } = useLocalSearchParams<{ deviceId: string; id: string }>();
  const [d, setD] = useState<LinkDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<LinkMessage>>(null);

  const load = useCallback(async () => {
    try {
      setD(await api.linkSession(deviceId, id));
    } catch (err) {
      reportError(err);
    }
  }, [deviceId, id]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 2_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      void load();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    void act(() => api.linkPrompt(deviceId, id, v));
  };

  const s = d?.session;
  const offline = s ? !s.online : false;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/devices' as never));
  const failed = (d?.commands ?? []).filter((x) => x.status === 'failed' || x.status === 'pending' || x.status === 'sent').slice(0, 3);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={s?.title || t('code.session.untitled')} subtitle={s ? `${s.deviceName} · ${s.directory}` : undefined} onBack={back} />
      <FlatList
        ref={list}
        data={d?.messages ?? []}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 14 }}
        ListHeaderComponent={offline ? <RNText style={[type.small, { color: c.text3 }]}>{t('link.offlineHint')}</RNText> : undefined}
        renderItem={({ item: m }) => (
          <View style={{ gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
            {m.parts.map((p, i) => (
              <PartView key={i} p={p} />
            ))}
          </View>
        )}
        ListFooterComponent={
          <View style={{ gap: 10 }}>
            {(d?.pending ?? []).map((q) => (
              <View key={q.requestId} style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: 12, gap: 8, backgroundColor: c.surface }}>
                {q.kind === 'permission' ? (
                  <>
                    <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: c.text }}>{t('link.permission', { name: q.permission ?? '' })}</RNText>
                    <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>{(q.patterns ?? []).join(' ')}</RNText>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button label={t('link.allowOnce')} disabled={busy || offline} onPress={() => act(() => api.linkPermission(deviceId, id, q.requestId, 'once'))} />
                      <Button label={t('link.reject')} variant="secondary" disabled={busy || offline} onPress={() => act(() => api.linkPermission(deviceId, id, q.requestId, 'reject'))} />
                    </View>
                  </>
                ) : (
                  <>
                    <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 14, color: c.text }}>{t('link.question')}</RNText>
                    <RNText style={[type.small, { color: c.text2 }]}>{q.questions}</RNText>
                    <RNText style={[type.small, { color: c.text3 }]}>{t('link.questionHint')}</RNText>
                  </>
                )}
              </View>
            ))}
            {failed.map((x) => (
              <RNText key={x.id} style={[type.small, { color: c.text3 }]}>
                {x.status === 'failed' ? t('link.cmdFailed', { kind: x.kind, error: x.error ?? '' }) : t('link.cmdSending', { kind: x.kind })}
              </RNText>
            ))}
          </View>
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!offline}
          multiline
          placeholder={t('link.placeholder')}
          placeholderTextColor={c.text3}
          style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.text, backgroundColor: c.surface, fontFamily: fonts.sans, fontSize: 15 }}
        />
        {s?.status === 'busy' ? (
          <Press accessibilityLabel={t('composer.stop')} onPress={() => act(() => api.linkAbort(deviceId, id))} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text }}>
            <Square size={16} color={c.bg} />
          </Press>
        ) : (
          <Press accessibilityLabel={t('composer.send')} disabled={!text.trim() || offline || busy} onPress={send} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text, opacity: !text.trim() || offline ? 0.4 : 1 }}>
            <ArrowUp size={18} color={c.bg} />
          </Press>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
