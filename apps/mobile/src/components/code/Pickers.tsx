import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text as RNText, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Check, ChevronLeft, GitBranch, Lock, Plus, Search, Settings2, Sparkles } from 'lucide-react-native';
import type { CodeEnvironmentDTO, GithubRepoDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { formatMb } from '../../lib/format.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useCode } from '../../store/code.ts';
import { Sheet } from '../Sheet.tsx';
import { Button, Press } from '../Ui.tsx';
import { GithubMark, NETWORK_ICON } from './CodeUi.tsx';

const SheetTitle = ({ children, onBack }: { children: string; onBack?: () => void }) => {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: onBack ? 8 : 22, paddingBottom: 10, minHeight: 36 }}>
      {onBack && (
        <Press haptics="tap" scale={0.88} onPress={onBack} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={22} color={c.text} />
        </Press>
      )}
      <RNText numberOfLines={1} style={[type.label, { color: c.text3, flex: 1 }]}>
        {children}
      </RNText>
    </View>
  );
};

/** Repo seç → taban branch seç. Seçim bitince `onPick(repo, branch)` çağrılır. */
export function RepoSheet({ visible, onClose, onPick, current }: { visible: boolean; onClose: () => void; onPick: (repo: string, branch: string) => void; current?: { repo: string; branch: string } | null }) {
  const { c } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const github = useCode((s) => s.status?.github);
  const connecting = useCode((s) => s.connecting);
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GithubRepoDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<GithubRepoDTO | null>(null);
  const [branches, setBranches] = useState<{ defaultBranch: string; branches: string[] } | null>(null);
  const seq = useRef(0);

  // Açılınca ilk adıma dön.
  useEffect(() => {
    if (visible) {
      setPicked(null);
      setBranches(null);
      setQuery('');
    }
  }, [visible]);

  // Arama (kısa gecikmeyle); eski yanıtlar yenisini ezmesin.
  useEffect(() => {
    if (!visible || !github || picked) return;
    const n = ++seq.current;
    const id = setTimeout(() => {
      api
        .codeRepos(query.trim() || undefined)
        .then((r) => {
          if (n === seq.current) {
            setRepos(r.repos);
            setFailed(false);
          }
        })
        .catch(() => n === seq.current && setFailed(true));
    }, repos ? 220 : 0);
    return () => clearTimeout(id);
  }, [visible, github, query, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (r: GithubRepoDTO) => {
    setPicked(r);
    setBranches(null);
    api
      .codeBranches(r.fullName)
      .then(setBranches)
      .catch(() => setBranches({ defaultBranch: r.defaultBranch, branches: [r.defaultBranch] }));
  };

  const listHeight = Math.min(420, height * 0.5);

  return (
    <Sheet visible={visible} onClose={onClose}>
      {!github ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}>
          <SheetTitle>{t('code.repo.pick')}</SheetTitle>
          <RNText style={[type.small, { color: c.text2, fontSize: 14, lineHeight: 20, paddingHorizontal: 2 }]}>{t('code.github.connectHint')}</RNText>
          <Button label={t('code.github.connect')} loading={connecting} icon={<GithubMark size={18} color={c.onAccent} />} onPress={() => void useCode.getState().connectGithub()} />
        </View>
      ) : picked ? (
        <View>
          <SheetTitle onBack={() => setPicked(null)}>{`${picked.fullName} · ${t('code.branch.pick')}`}</SheetTitle>
          <View style={{ maxHeight: listHeight }}>
            {!branches ? (
              <ActivityIndicator color={c.text3} style={{ marginTop: 30 }} />
            ) : (
              <FlatList
                data={branches.branches}
                keyExtractor={(b) => b}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}
                renderItem={({ item }) => {
                  const on = current?.repo === picked.fullName && current.branch === item;
                  return (
                    <Press
                      haptics="select"
                      scale={0.985}
                      onPress={() => {
                        onPick(picked.fullName, item);
                        onClose();
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : 'transparent' }}
                    >
                      <GitBranch size={17} color={c.text2} />
                      <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 14, color: c.text }}>
                        {item}
                      </RNText>
                      {item === branches.defaultBranch && <RNText style={[type.small, { color: c.text3 }]}>{t('code.branch.default')}</RNText>}
                      {on && <Check size={18} color={c.accent} />}
                    </Press>
                  );
                }}
              />
            )}
          </View>
        </View>
      ) : (
        <View>
          <SheetTitle>{t('code.repo.pick')}</SheetTitle>
          <View style={{ marginHorizontal: 16, marginBottom: 8, height: 44, borderRadius: radius.md, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
            <Search size={16} color={c.text3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('code.repo.search')}
              placeholderTextColor={c.text3}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, fontFamily: fonts.sans, fontSize: 15, color: c.text, paddingVertical: 0 }}
              cursorColor={c.accent}
              selectionColor={c.accentSoft}
            />
          </View>
          <View style={{ maxHeight: listHeight }}>
            {!repos && !failed ? (
              <ActivityIndicator color={c.text3} style={{ marginTop: 30 }} />
            ) : (
              <FlatList
                data={repos ?? []}
                keyExtractor={(r) => r.fullName}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}
                ListEmptyComponent={<RNText style={[type.small, { color: c.text3, textAlign: 'center', padding: 28 }]}>{failed ? t('error.generic') : t('code.repo.none')}</RNText>}
                renderItem={({ item }) => {
                  const [owner, name] = item.fullName.split('/');
                  const on = current?.repo === item.fullName;
                  return (
                    <Press
                      haptics="select"
                      scale={0.985}
                      onPress={() => choose(item)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : 'transparent' }}
                    >
                      <View style={{ flex: 1, gap: 1 }}>
                        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text2 }}>
                          {owner}/<RNText style={{ fontFamily: fonts.sansSemibold, color: c.text }}>{name}</RNText>
                        </RNText>
                        {!!item.description && (
                          <RNText numberOfLines={1} style={[type.small, { color: c.text3 }]}>
                            {item.description}
                          </RNText>
                        )}
                      </View>
                      {item.private && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: c.surface3 }}>
                          <Lock size={11} color={c.text2} />
                          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 11.5, color: c.text2 }}>{t('code.repo.private')}</RNText>
                        </View>
                      )}
                    </Press>
                  );
                }}
              />
            )}
          </View>
        </View>
      )}
    </Sheet>
  );
}

/** Ortam seçici; "Ortam ekle" ve ortam başına düzenleme kısayolu. */
export function EnvSheet({ visible, onClose, value, onPick }: { visible: boolean; onClose: () => void; value: string | null; onPick: (e: CodeEnvironmentDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const envs = useCode((s) => s.environments);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
        <SheetTitle>{t('code.env.pick')}</SheetTitle>
        {(envs ?? []).map((e) => {
          const on = e.id === value;
          const Icon = NETWORK_ICON[e.network];
          return (
            <Press
              key={e.id}
              haptics="select"
              scale={0.985}
              onPress={() => {
                onPick(e);
                onClose();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingLeft: 14, paddingRight: 6, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : 'transparent' }}
            >
              <Icon size={19} color={on ? c.accent : c.text2} />
              <View style={{ flex: 1 }}>
                <RNText numberOfLines={1} style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>
                  {e.name}
                </RNText>
                <RNText numberOfLines={1} style={[type.small, { color: c.text3 }]}>
                  {t(`code.env.network.${e.network}` as 'code.env.network.none')} · {formatMb(e.diskMb, locale)}
                </RNText>
              </View>
              {on && <Check size={18} color={c.accent} />}
              <Press
                accessibilityLabel={t('code.env.edit')}
                haptics="tap"
                scale={0.88}
                hitSlop={4}
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/code/env', params: { id: e.id } });
                }}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Settings2 size={18} color={c.text3} />
              </Press>
            </Press>
          );
        })}
        <Press
          haptics="tap"
          scale={0.985}
          onPress={() => {
            onClose();
            router.push('/code/env');
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 54, paddingHorizontal: 14, borderRadius: radius.md }}
        >
          <Plus size={19} color={c.text2} />
          <RNText style={[type.body, { color: c.text2, fontFamily: fonts.sansMedium }]}>{t('code.addEnvironment')}</RNText>
        </Press>
      </View>
    </Sheet>
  );
}

/** Model: tek seçenek, Auto. */
export function ModelSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
        <SheetTitle>{t('code.m.model')}</SheetTitle>
        <Press haptics="select" scale={0.985} onPress={onClose} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: c.accentSoft }}>
          <Sparkles size={19} color={c.accent} />
          <View style={{ flex: 1 }}>
            <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>{t('code.model')}</RNText>
            <RNText style={[type.small, { color: c.text3 }]}>{t('code.modelHint')}</RNText>
          </View>
          <Check size={18} color={c.accent} />
        </Press>
      </View>
    </Sheet>
  );
}
