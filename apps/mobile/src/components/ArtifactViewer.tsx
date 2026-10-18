import { useEffect, useMemo, useState } from 'react';
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
import { Markdown } from './markdown/Markdown.tsx';
import { SandboxWebView } from './SandboxWebView';
import { Press } from './Ui.tsx';

const LANG: Record<ArtifactKind, string> = { html: 'html', svg: 'xml', markdown: 'markdown', mermaid: 'text' };

/** İçerikte geçen en uzun ` dizisinden daha uzun bir çit seçer (kodu bozmadan göstermek için). */
function fenced(code: string, lang: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${code}\n${fence}`;
}

/** Artifact'ı tam ekranda gösterir: Önizleme / Kod sekmeleri, sürümler, kopyala ve paylaş. */
export function ArtifactViewer() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const id = useUi((s) => s.artifactId);
  const close = useUi((s) => s.closeArtifact);
  const detail = useChats((s) => (s.activeId ? s.detail[s.activeId] : undefined));
  const entries = useMemo(() => collectArtifacts(selectPath(detail).map((m) => (m.role === 'assistant' ? m.content : ''))), [detail]);
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
  // Yazılırken kodu göster; bitince önizlemeye geç.
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
                const disabled = k === 'preview' && writing;
                return (
                  <Press
                    key={k}
                    haptics="select"
                    scale={0.97}
                    disabled={disabled}
                    onPress={() => setTab(k)}
                    style={{ height: 32, paddingHorizontal: 16, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface3 : 'transparent', opacity: disabled ? 0.45 : 1 }}
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
              <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }}>
                {current.content ? <Markdown text={fenced(current.content, LANG[entry.kind])} /> : <RNText style={[type.body, { color: c.text3, padding: 16 }]}>{t('artifact.empty')}</RNText>}
              </ScrollView>
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
