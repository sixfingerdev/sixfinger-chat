import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Ellipsis, GitBranch, Trash2 } from 'lucide-react-native';
import type { CodeSessionDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { formatMb } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useCode } from '../../store/code.ts';
import { useUi } from '../../store/ui.ts';
import { Sheet } from '../../components/Sheet.tsx';
import { Press } from '../../components/Ui.tsx';
import { CodeHeader, GithubMark, NETWORK_ICON, SlashProgress } from '../../components/code/CodeUi.tsx';
import { Mascot } from '../../components/code/Mascot.tsx';

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 }}>
      <View style={{ width: 22, alignItems: 'center' }}>{icon}</View>
      <RNText style={[type.small, { color: c.text3, width: 96 }]}>{label}</RNText>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/** Code oturumu. Faz 1: çalıştırma yok; oturum bilgisi, ilk görev ve devre dışı composer. */
export default function CodeSession() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = useCode((s) => s.sessions?.find((x) => x.chatId === id));
  const envs = useCode((s) => s.environments);
  const firstTask = useCode((s) => (id ? s.firstTask[id] : undefined));
  const [session, setSession] = useState<CodeSessionDTO | null>(cached ?? null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .codeSession(id)
      .then(({ session: s }) => {
        setSession(s);
        useCode.getState().upsertSession(s);
      })
      .catch((err) => {
        reportError(err);
        router.back();
      });
  }, [id]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/code'));
  const env = envs?.find((e) => e.id === session?.environmentId);
  const EnvIcon = NETWORK_ICON[env?.network ?? 'trusted'];

  const remove = () =>
    useUi.getState().askConfirm({
      title: t('code.session.delete'),
      message: t('code.session.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.codeDeleteSession(id!);
          useCode.getState().removeSession(id!);
          haptic.success();
          back();
        } catch (err) {
          reportError(err);
        }
      },
    });

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <CodeHeader title="" onBack={back} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text3} />
        </View>
      </View>
    );
  }

  const shortRepo = session.repo.split('/')[1] ?? session.repo;
  const title = session.title === 'Yeni oturum' ? t('code.session.untitled') : session.title;
  const card = { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: 16 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader
        title={title}
        subtitle={`${shortRepo}${session.environmentName ? ` · ${session.environmentName}` : ''}`}
        onBack={back}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {session.status === 'running' && <ActivityIndicator size="small" color={c.text2} style={{ marginRight: 6 }} />}
            <Press accessibilityLabel="Menu" haptics="tap" scale={0.88} onPress={() => setMenu(true)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
              <Ellipsis size={22} color={c.text} />
            </Press>
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 }}>
        {!!firstTask && (
          <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.surface2, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 12 }}>
            <RNText style={[type.body, { color: c.text }]}>{firstTask}</RNText>
          </View>
        )}

        <View style={[card, { alignItems: 'center', gap: 12, paddingVertical: 22 }]}>
          <Mascot size={96} />
          <RNText style={[type.small, { color: c.text2, textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{t('code.soon')}</RNText>
        </View>

        <View style={[card, { gap: 12 }]}>
          <InfoRow icon={<GithubMark size={16} color={c.text2} />} label={t('code.repo')}>
            <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
              {session.repo}
            </RNText>
          </InfoRow>
          <InfoRow icon={<GitBranch size={16} color={c.text2} />} label={t('code.branch')}>
            <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
              {session.baseBranch}
            </RNText>
          </InfoRow>
          <InfoRow icon={<GitBranch size={16} color={c.accent} />} label={t('code.branch.work')}>
            <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
              {session.workBranch}
            </RNText>
          </InfoRow>
          <InfoRow icon={<EnvIcon size={16} color={c.text2} />} label={t('code.env')}>
            <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
              {session.environmentName ?? '—'}
            </RNText>
          </InfoRow>
          {env && (
            <InfoRow icon={<View style={{ width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, borderColor: c.text2 }} />} label={t('code.env.disk')}>
              <View style={{ gap: 6 }}>
                <RNText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: c.text2 }}>
                  {t('code.disk.used', { used: formatMb(session.diskUsedMb, locale), total: formatMb(env.diskMb, locale) })}
                </RNText>
                <SlashProgress value={session.diskUsedMb} max={env.diskMb} />
              </View>
            </InfoRow>
          )}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) + 6, gap: 8, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 }}>
          <GithubMark size={14} color={c.text3} />
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>
            {shortRepo}
          </RNText>
          <GitBranch size={13} color={c.text3} />
          <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
            {session.workBranch}
          </RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, opacity: 0.6 }}>
          <TextInput editable={false} placeholder={t('code.composer.placeholder')} placeholderTextColor={c.text3} style={{ flex: 1, fontFamily: fonts.sans, fontSize: 16, color: c.text, minHeight: 36, paddingVertical: 6 }} />
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowUp size={19} strokeWidth={2.5} color={c.text3} />
          </View>
        </View>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
          <Press
            haptics="tap"
            scale={0.985}
            onPress={() => {
              setMenu(false);
              remove();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 12, borderRadius: radius.md }}
          >
            <Trash2 size={19} color={c.danger} />
            <RNText style={[type.body, { color: c.danger }]}>{t('code.session.delete')}</RNText>
          </Press>
        </View>
      </Sheet>
    </View>
  );
}
