import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text as RNText, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, ChevronRight, Download, Plus, Search } from 'lucide-react-native';
import type { SkillListItemDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useUi } from '../../store/ui.ts';
import { Press } from '../../components/Ui.tsx';
import { CodeHeader, SectionLabel } from '../../components/code/CodeUi.tsx';
import { ImportSkillSheet } from '../../components/code/SkillImport.tsx';

type Row = { kind: 'label'; key: string; text: string } | { kind: 'empty'; key: string } | { kind: 'skill'; key: string; s: SkillListItemDTO };

/** Skill'ler: kendi skill'lerin + yerleşik kütüphane; oluştur, düzenle, GitHub'dan al. */
export default function CodeSkills() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SkillListItemDTO[] | null>(null);
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    api
      .codeSkills()
      .then((r) => setItems(r.skills))
      .catch((err) => {
        setItems([]);
        reportError(err);
      });
  }, []);
  useEffect(load, [load]);
  // Düzenleyiciden dönünce liste tazelenir.
  useFocusEffect(useCallback(() => load(), [load]));

  const rows = useMemo<Row[]>(() => {
    const k = q.trim().toLowerCase();
    const shown = (items ?? []).filter((s) => !k || `${s.name} ${s.description} ${s.triggers.join(' ')}`.toLowerCase().includes(k));
    const mine = shown.filter((s) => s.source === 'user');
    const builtin = shown.filter((s) => s.source === 'builtin');
    return [
      { kind: 'label', key: 'l-mine', text: t('code.skills.mine') },
      ...(mine.length ? mine.map((s) => ({ kind: 'skill' as const, key: `u-${s.name}`, s })) : [{ kind: 'empty' as const, key: 'empty' }]),
      { kind: 'label', key: 'l-builtin', text: t('code.skills.builtin') },
      ...builtin.map((s) => ({ kind: 'skill' as const, key: `b-${s.name}`, s })),
    ];
  }, [items, q, t]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/code'));
  const open = (s: SkillListItemDTO) => router.push({ pathname: '/code/skill', params: { name: s.name, source: s.source } } as never);
  const iconBtn = { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader
        title={t('code.skills.title')}
        onBack={back}
        right={
          <>
            <Press accessibilityLabel={t('code.skills.import')} haptics="tap" scale={0.88} onPress={() => setImporting(true)} style={iconBtn}>
              <Download size={19} color={c.text} />
            </Press>
            <Press accessibilityLabel={t('code.skills.new')} haptics="tap" scale={0.88} onPress={() => router.push({ pathname: '/code/skill', params: { source: 'user' } } as never)} style={iconBtn}>
              <Plus size={21} color={c.text} />
            </Press>
          </>
        }
      />
      {!items ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text3} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, gap: 12, paddingTop: 4 }}>
              <RNText style={[type.small, { color: c.text3 }]}>{t('code.skills.intro')}</RNText>
              <View style={{ height: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
                <Search size={16} color={c.text3} />
                <TextInput value={q} onChangeText={setQ} placeholder={t('code.skills.search')} placeholderTextColor={c.text3} cursorColor={c.accent} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 15, color: c.text, padding: 0 }} />
              </View>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'label') return <SectionLabel>{item.text}</SectionLabel>;
            if (item.kind === 'empty') return <RNText style={[type.small, { color: c.text3, paddingHorizontal: 20 }]}>{t('code.skills.empty')}</RNText>;
            const s = item.s;
            return (
              <Press scale={0.985} haptics="select" onPress={() => open(s)} style={{ marginHorizontal: 16, marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <BookOpen size={16} color={c.text2} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <RNText numberOfLines={1} style={{ fontFamily: fonts.monoMedium, fontSize: 14, color: c.text }}>
                    {s.name}
                    {s.importedFrom ? `  · ${t('code.skills.imported')}` : s.shareToken ? `  · ${t('code.skills.share')}` : ''}
                  </RNText>
                  <RNText numberOfLines={2} style={{ fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: c.text3 }}>
                    {s.description}
                  </RNText>
                </View>
                <ChevronRight size={16} color={c.text3} />
              </Press>
            );
          }}
        />
      )}
      <ImportSkillSheet
        visible={importing}
        onClose={() => setImporting(false)}
        onDone={(n) => {
          setImporting(false);
          useUi.getState().toast({ kind: 'success', text: t('code.skills.importDone', { n }) });
          load();
        }}
      />
    </View>
  );
}
