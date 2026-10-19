import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text as RNText, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Code2, FileText, Globe, Image as ImageIcon, Search } from 'lucide-react-native';
import type { ArtifactListItemDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { ago } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Button, Press } from '../components/Ui.tsx';
import { CodeHeader } from '../components/code/CodeUi.tsx';

const ICON = { html: Globe, svg: ImageIcon, markdown: FileText, mermaid: Code2 } as const;

/** Artifacts: sohbetlerde üretilmiş tüm artifact'lar (en yeni sürümle). Birine dokununca sohbet açılır ve görüntüleyici gelir. */
export default function Artifacts() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ArtifactListItemDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await api.artifacts()).artifacts);
      setFailed(false);
    } catch (err) {
      setFailed(true);
      reportError(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const k = q.trim().toLowerCase();
  const shown = useMemo(() => (items ?? []).filter((a) => !k || `${a.title} ${a.chatTitle}`.toLowerCase().includes(k)), [items, k]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const open = (a: ArtifactListItemDTO) => {
    void useChats.getState().openChat(a.chatId);
    back();
    useUi.getState().openArtifact(a.artifactId);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('art.title')} onBack={back} />
      {!items ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          {failed ? <Button label={t('common.retry')} variant="secondary" onPress={() => void load()} /> : <ActivityIndicator color={c.text3} />}
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(a) => `${a.chatId}:${a.artifactId}`}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={c.text3} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 28, gap: 8 }}
          ListHeaderComponent={
            <View style={{ gap: 12, paddingBottom: 6 }}>
              <RNText style={[type.small, { color: c.text3 }]}>{t('art.subtitle')}</RNText>
              {items.length > 0 && (
                <View style={{ height: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
                  <Search size={16} color={c.text3} />
                  <TextInput value={q} onChangeText={setQ} placeholder={t('art.search')} placeholderTextColor={c.text3} cursorColor={c.accent} autoCorrect={false} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 15, color: c.text, padding: 0 }} />
                </View>
              )}
            </View>
          }
          ListEmptyComponent={<RNText style={[type.body, { color: c.text3, textAlign: 'center', paddingTop: 36, paddingHorizontal: 20 }]}>{items.length ? t('art.noResults') : t('art.empty')}</RNText>}
          renderItem={({ item: a }) => {
            const Icon = ICON[a.kind];
            return (
              <Press haptics="tap" scale={0.985} onPress={() => open(a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} color={c.text2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <RNText numberOfLines={1} style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text }}>{a.title}</RNText>
                  <RNText numberOfLines={2} style={[type.small, { color: c.text3 }]}>
                    {t(`art.kind.${a.kind}` as 'art.kind.html')} · {ago(a.updatedAt, locale)}
                    {a.versions > 1 ? ` · ${t('art.versions', { n: a.versions })}` : ''} · {t('art.from', { title: a.chatTitle })}
                  </RNText>
                </View>
                <ChevronRight size={16} color={c.text3} />
              </Press>
            );
          }}
        />
      )}
    </View>
  );
}
