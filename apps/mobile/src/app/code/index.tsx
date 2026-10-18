import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Lock, Plus, Unplug } from 'lucide-react-native';
import type { CodeEnvironmentDTO, CodeSessionDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { ago } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { useAuth } from '../../store/auth.ts';
import { useCode } from '../../store/code.ts';
import { useUi } from '../../store/ui.ts';
import { useDrawer } from '../../components/Drawer.tsx';
import { Button, Press } from '../../components/Ui.tsx';
import { Mascot } from '../../components/code/Mascot.tsx';
import { Chip, CodeHeader, GithubMark, NETWORK_ICON, SectionLabel, SlashProgress, StatusDot } from '../../components/code/CodeUi.tsx';

const SessionCard = memo(function SessionCard({ s, onOpen, onMenu }: { s: CodeSessionDTO; onOpen: (s: CodeSessionDTO) => void; onMenu: (s: CodeSessionDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <Press
      scale={0.985}
      haptics="tap"
      onPress={() => onOpen(s)}
      onLongPress={() => {
        haptic.press();
        onMenu(s);
      }}
      delayLongPress={320}
      style={{ marginHorizontal: 16, marginBottom: 10, padding: 14, gap: 12, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={{ fontFamily: fonts.monoMedium, fontSize: 14, color: c.text2 }}>{'</>'}</RNText>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.sansMedium, fontSize: 16, color: c.text }}>
              {s.title === 'Yeni oturum' ? (s.repo.split('/')[1] ?? t('code.session.untitled')) : s.title}
            </RNText>
            <RNText style={[type.small, { color: c.text3 }]}>{ago(s.lastMessageAt ?? s.createdAt, locale)}</RNText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StatusDot status={s.status} />
            <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12.5, color: c.text3 }}>
              {s.title === 'Yeni oturum' ? `${s.baseBranch}${s.environmentName ? ` · ${s.environmentName}` : ''}` : `${s.repo.split('/')[1] ?? s.repo} · ${s.baseBranch}`}
            </RNText>
          </View>
        </View>
      </View>
      {!!s.preview && (
        <View style={{ backgroundColor: c.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 }}>
          <RNText numberOfLines={2} style={[type.small, { color: c.text2, fontSize: 14, lineHeight: 20 }]}>
            {s.preview}
          </RNText>
        </View>
      )}
    </Press>
  );
});

function GithubCard() {
  const { c } = useTheme();
  const t = useT();
  const github = useCode((s) => s.status?.github);
  const connecting = useCode((s) => s.connecting);
  if (github) {
    return (
      <View style={{ marginHorizontal: 16, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 14, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {github.avatarUrl ? <Image source={{ uri: github.avatarUrl }} style={{ width: 36, height: 36 }} /> : <GithubMark size={19} />}
        </View>
        <View style={{ flex: 1 }}>
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14.5, color: c.text }}>
            {t('code.github.connected', { login: github.login })}
          </RNText>
        </View>
        <Press
          accessibilityLabel={t('code.github.disconnect')}
          haptics="tap"
          scale={0.9}
          hitSlop={8}
          onPress={() =>
            useUi.getState().askConfirm({
              title: t('code.github.disconnect'),
              message: t('code.github.disconnectConfirm'),
              confirmLabel: t('code.github.disconnect'),
              cancelLabel: t('common.cancel'),
              destructive: true,
              onConfirm: () => void useCode.getState().disconnectGithub(),
            })
          }
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}
        >
          <Unplug size={18} color={c.text2} />
        </Press>
      </View>
    );
  }
  return (
    <View style={{ marginHorizontal: 16, marginTop: 6, padding: 16, gap: 14, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <GithubMark size={24} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <RNText style={[type.heading as never, { color: c.text }]}>{t('code.github.connect')}</RNText>
          <RNText style={[type.small, { color: c.text2, fontSize: 14, lineHeight: 20 }]}>{t('code.github.connectHint')}</RNText>
        </View>
      </View>
      <Button label={t('code.github.connect')} loading={connecting} icon={<GithubMark size={18} color={c.onAccent} />} onPress={() => void useCode.getState().connectGithub()} />
    </View>
  );
}

function EnvStrip() {
  const t = useT();
  const envs = useCode((s) => s.environments);
  return (
    <>
      <SectionLabel>{t('code.environments')}</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {(envs ?? []).map((e: CodeEnvironmentDTO) => {
          const Icon = NETWORK_ICON[e.network];
          return <EnvChip key={e.id} env={e} Icon={Icon} />;
        })}
        <Chip dashed icon={<PlusIcon />} label={t('code.addEnvironment')} onPress={() => router.push('/code/env')} />
      </ScrollView>
    </>
  );
}

const PlusIcon = () => {
  const { c } = useTheme();
  return <Plus size={16} color={c.text2} />;
};

function EnvChip({ env, Icon }: { env: CodeEnvironmentDTO; Icon: (typeof NETWORK_ICON)[keyof typeof NETWORK_ICON] }) {
  const { c } = useTheme();
  return <Chip icon={<Icon size={15} color={c.text2} />} label={env.name} maxWidth={220} onPress={() => router.push({ pathname: '/code/env', params: { id: env.id } })} />;
}

function Credits() {
  const { c } = useTheme();
  const t = useT();
  const credits = useCode((s) => s.status?.credits);
  if (!credits) return null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 14, gap: 8, paddingHorizontal: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <RNText style={[type.small, { color: c.text2 }]}>{t('code.credits')}</RNText>
        <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>{t('code.credits.value', { used: Math.round(credits.used * 10) / 10, limit: credits.limit })}</RNText>
      </View>
      <SlashProgress value={credits.used} max={credits.limit} />
    </View>
  );
}

function Gate({ title, hint, action }: { title: string; hint: string; action?: { label: string; run: () => void } }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16, paddingBottom: 60 }}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Lock size={24} color={c.text2} />
      </View>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <RNText style={[type.title, { color: c.text, textAlign: 'center' }]}>{title}</RNText>
        <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{hint}</RNText>
      </View>
      {action && <Button label={action.label} onPress={action.run} style={{ alignSelf: 'stretch' }} />}
    </View>
  );
}

export default function CodeHome() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const user = useAuth((s) => s.user);
  const status = useCode((s) => s.status);
  const sessions = useCode((s) => s.sessions);
  const loading = useCode((s) => s.loading);
  const params = useLocalSearchParams<{ gh_code?: string; gh_state?: string; github?: string }>();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void useCode.getState().loadAll();
  }, []);

  // GitHub izin sayfasından dönüş: sixfinger://code?gh_code=…&gh_state=… (başarı) ya da ?github=error.
  // Bağlantı bu oturumla tamamlanır; parametreler hemen rotadan silinir (kod yeniden kullanılmasın).
  useEffect(() => {
    const { gh_code: code, gh_state: state, github } = params;
    if (!code && !state && !github) return;
    router.setParams({ gh_code: undefined, gh_state: undefined, github: undefined });
    if (code && state) void useCode.getState().completeGithub(code, state);
    else if (github === 'error') {
      useCode.setState({ connecting: false });
      useUi.getState().toast({ kind: 'error', text: t('code.github.error') });
    }
  }, [params.gh_code, params.gh_state, params.github]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tarayıcıdan dönünce (deep link gelmese de) durumu yenile.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && useCode.getState().connecting) {
        useCode.setState({ connecting: false });
        void useCode.getState().loadStatus().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const open = useCallback((s: CodeSessionDTO) => router.push(`/code/${s.chatId}`), []);
  const menu = useCallback(
    (s: CodeSessionDTO) =>
      useUi.getState().askConfirm({
        title: t('code.session.delete'),
        message: t('code.session.deleteConfirm'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
        onConfirm: async () => {
          try {
            await api.codeDeleteSession(s.chatId);
            useCode.getState().removeSession(s.chatId);
            haptic.success();
          } catch (err) {
            reportError(err);
          }
        },
      }),
    [t],
  );

  const refresh = async () => {
    setRefreshing(true);
    await useCode.getState().loadAll();
    setRefreshing(false);
  };

  let body;
  if (user && !user.emailVerified) {
    body = <Gate title={t('code.notAllowed')} hint={t('code.verifyFirst')} action={{ label: t('banner.verifyAction'), run: () => router.push({ pathname: '/auth', params: { mode: 'verify' } }) }} />;
  } else if (!status) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.text3} />
      </View>
    );
  } else if (!status.available) {
    body = <Gate title={t('code.notAllowed')} hint={t('code.unavailable')} />;
  } else if (!status.allowed) {
    body = <Gate title={t('code.notAllowed')} hint={t('code.notAllowedHint')} />;
  } else {
    body = (
      <>
        <FlatList
          data={sessions ?? []}
          keyExtractor={(s) => s.chatId}
          renderItem={({ item }) => <SessionCard s={item} onOpen={open} onMenu={menu} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.text3} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          ListHeaderComponent={
            <View>
              <GithubCard />
              <Credits />
              <EnvStrip />
              <SectionLabel>{t('code.sessions')}</SectionLabel>
            </View>
          }
          ListEmptyComponent={
            sessions && !loading ? (
              <Animated.View entering={FadeInDown.duration(380)} style={{ alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 40 }}>
                <Mascot size={104} animate={false} />
                <RNText style={[type.heading as never, { color: c.text, marginTop: 8 }]}>{t('code.empty')}</RNText>
                <RNText style={[type.small, { color: c.text3, textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{t('code.emptyHint')}</RNText>
              </Animated.View>
            ) : undefined
          }
        />
        <Press
          haptics="tap"
          scale={0.95}
          onPress={() => router.push('/code/new')}
          style={{
            position: 'absolute',
            right: 16,
            bottom: insets.bottom + 18,
            height: 54,
            borderRadius: 27,
            paddingHorizontal: 22,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: c.inverse,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Plus size={20} strokeWidth={2.4} color={c.onInverse} />
          <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 15.5, color: c.onInverse }}>{t('code.newSession')}</RNText>
        </Press>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('code.title')} onMenu={drawer.open} />
      {body}
    </View>
  );
}
