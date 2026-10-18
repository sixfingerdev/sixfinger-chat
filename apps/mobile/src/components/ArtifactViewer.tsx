import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Share, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Copy, Share2, X } from 'lucide-react-native';
import { collectArtifacts, type ArtifactKind } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { copyText } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { useT } from '../lib/i18n/index.ts';
import { selectPath, useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { CodeView } from './CodeView.tsx';
import { Markdown } from './markdown/Markdown.tsx';
import { SandboxWebView } from './SandboxWebView';
import { Press } from './Ui.tsx';

const LANG: Record<ArtifactKind, string> = { html: 'html', svg: 'xml', markdown: 'markdown', mermaid: 'text' };

/** Değer çok sık değişirken (akış) en çok `ms` aralıkla günceller; etkin değilse anında. */
function useThrottled<T>(value: T, ms: number, enabled: boolean): T {
  const [v, setV] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setV(value);
      return;
    }
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setV(value);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setV(value);
    }, wait);
    return () => clearTimeout(timer.current);
  }, [value, ms, enabled]);
  return v;
}

/** Artifact'ı tam ekranda gösterir: Önizleme / Kod sekmeleri, sürümler, kopyala ve paylaş. */
export function ArtifactViewer() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const id = useUi((s) => s.artifactId);
  const close = useUi((s) => s.closeArtifact);
  const liveDetail = useChats((s) => (s.activeId ? s.detail[s.activeId] : undefined));
  const generating = useChats((s) => Boolean(s.activeId && s.generating[s.activeId]));
  // Üretim sürerken içerik her karede değişir: görüntüleyici en çok 400 ms'de bir güncellenir (donmayı önler).
  const detail = useThrottled(liveDetail, 400, generating);
  // Kapalıyken (artifact seçili değil) hiçbir şey ayrıştırılmaz.
  const entries = useMemo(
    () => (id ? collectArtifacts(selectPath(detail).map((m) => (m.role === 'assistant' ? m.content : ''))) : []),
    [id, detail],
  );
  const entry = entries.find((e) => e.id === id);

  const [version, setVersion] = useState<number | null>(null);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idx = entry ? Math.min(version ?? entry.versions.length - 1, entry.versions.length - 1) : 0;
  const current = entry?.versions[idx];
  const writing = Boolean(current && !current.closed);

  useEffect(() => {
    setVersion(null);
    setError(null);
  }, [id]);
  // Yazılırken kodu (son satırlar) göster; bitince önizlemeye geç.
  useEffect(() => {
    setTab(writing ? 'code' : 'preview');
    if (!writing) setError(null);
  }, [writing, id]);

  const visible = Boolean(id && entry && current);
  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={close}>
      {entry && current && (
        <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 56 }}>
            <Press accessibilityLabel={t('common.close')} haptics="tap" scale={0.88} onPress={close} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
              <X size={22} color={c.text} />
            </Press>
            <View style={{ flex: 1 }}>
              <RNText numberOfLines={1} style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text }}>
                {entry.title}
              </RNText>
              <RNText style={[type.small, { color: c.text3 }]}>
                {t(`artifact.kind.${entry.kind}` as 'artifact.kind.html')}
                {entry.versions.length > 1 ? ` · ${t('artifact.version', { n: idx + 1 })}/${entry.versions.length}` : ''}
              </RNText>
            </View>
            <Press
              accessibilityLabel={t('common.copy')}
              haptics="tap"
              scale={0.88}
              onPress={async () => {
                if (await copyText(current.content)) {
                  haptic.success();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}
            >
              {copied ? <Check size={20} color={c.success} /> : <Copy size={20} color={c.text2} />}
            </Press>
            <Press
              accessibilityLabel={t('artifact.download')}
              haptics="tap"
              scale={0.88}
              onPress={() => void Share.share({ title: entry.title, message: current.content }).catch(() => {})}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}
            >
              <Share2 size={20} color={c.text2} />
            </Press>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: c.line }}>
              {(['preview', 'code'] as const).map((k) => {
                const on = tab === k;
                return (
                  <Press
                    key={k}
                    haptics="select"
                    scale={0.97}
                    onPress={() => setTab(k)}
                    style={{ height: 32, paddingHorizontal: 16, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface3 : 'transparent' }}
                  >
                    <RNText style={{ fontFamily: on ? fonts.sansSemibold : fonts.sansMedium, fontSize: 13.5, color: on ? c.text : c.text2 }}>{t(k === 'preview' ? 'artifact.preview' : 'artifact.code')}</RNText>
                  </Press>
                );
              })}
            </View>
            {entry.versions.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {entry.versions.map((_, i) => (
                  <Press
                    key={i}
                    haptics="select"
                    scale={0.9}
                    onPress={() => setVersion(i)}
                    style={{ minWidth: 32, height: 32, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: i === idx ? c.accentSoft : c.surface2 }}
                  >
                    <RNText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: i === idx ? c.accent : c.text2 }}>{i + 1}</RNText>
                  </Press>
                ))}
              </View>
            )}
          </View>

          {!!error && tab === 'preview' && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.dangerSoft }}>
              <RNText style={[type.small, { color: c.danger }]}>
                {t('artifact.error')}: {error}
              </RNText>
            </View>
          )}

          <View style={{ flex: 1 }}>
            {tab === 'code' ? (
              <CodeView code={current.content} lang={LANG[entry.kind]} writing={writing} bottomInset={insets.bottom} />
            ) : writing ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <RNText style={[type.body, { color: c.text3, textAlign: 'center' }]}>{t('artifact.previewPending')}</RNText>
              </View>
            ) : entry.kind === 'markdown' ? (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
                <Markdown text={current.content} />
              </ScrollView>
            ) : (
              <SandboxWebView key={`${id}-${idx}`} kind={entry.kind} mode="artifact" content={current.content} style={{ flex: 1 }} onError={setError} onPrompt={(text) => { useUi.getState().setPrefill(text); close(); }} />
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}
