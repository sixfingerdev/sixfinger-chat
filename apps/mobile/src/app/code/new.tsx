import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { ArrowUp, GitBranch, Sparkles } from 'lucide-react-native';
import { pickCodeGreeting } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useAuth } from '../../store/auth.ts';
import { useCode } from '../../store/code.ts';
import { Press } from '../../components/Ui.tsx';
import { Chip, CodeHeader, GithubMark, NETWORK_ICON } from '../../components/code/CodeUi.tsx';
import { Mascot } from '../../components/code/Mascot.tsx';
import { EnvSheet, ModelSheet, RepoSheet } from '../../components/code/Pickers.tsx';

export default function NewCodeSession() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const envs = useCode((s) => s.environments);
  const [text, setText] = useState('');
  const [repo, setRepo] = useState<{ repo: string; branch: string } | null>(null);
  const [envId, setEnvId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'repo' | 'env' | 'model' | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const name = user && !user.isGuest ? user.settings.customName || user.displayName.split(' ')[0] : undefined;
  // Ekran her açıldığında yeni bir başlık seç; yeniden çizimlerde sabit kalsın.
  const greeting = useMemo(() => {
    const d = new Date();
    return pickCodeGreeting({ locale, name, hour: d.getHours(), day: d.getDay() });
  }, [locale, name]);

  useEffect(() => {
    if (!envs) void useCode.getState().loadEnvironments().catch(() => {});
  }, [envs]);
  const env = envs?.find((e) => e.id === envId) ?? envs?.[0] ?? null;
  const EnvIcon = env ? NETWORK_ICON[env.network] : NETWORK_ICON.trusted;

  const canSend = Boolean(repo && text.trim()) && !busy;
  const send = useSharedValue(1);
  useEffect(() => {
    send.value = withSpring(canSend ? 1 : 0.9, { damping: 14, stiffness: 260 });
  }, [canSend, send]);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: send.value }] }));

  const submit = async () => {
    if (!repo || !canSend) return;
    setBusy(true);
    haptic.tap();
    try {
      const { session } = await api.codeCreateSession({ repo: repo.repo, baseBranch: repo.branch, environmentId: env?.id });
      useCode.getState().upsertSession(session);
      useCode.getState().setPendingPrompt(session.chatId, text.trim());
      haptic.success();
      router.replace(`/code/${session.chatId}`);
    } catch (err) {
      reportError(err);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('code.newSession')} subtitle={repo ? repo.repo : undefined} onBack={() => (router.canGoBack() ? router.back() : router.replace('/code'))} />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 24 }}>
        <Animated.View entering={FadeInDown.duration(420)} style={{ alignItems: 'center', gap: 22 }}>
          <Mascot size={148} />
          <RNText style={[type.title, { fontSize: 28, lineHeight: 35, color: c.text, textAlign: 'center' }]}>{greeting}</RNText>
        </Animated.View>
      </View>

      <View style={{ paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8) + 6, gap: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}>
          <Chip icon={<EnvIcon size={16} color={c.text2} />} label={env?.name ?? t('code.env')} maxWidth={170} onPress={() => setSheet('env')} />
          <Chip
            active={Boolean(repo)}
            icon={<GithubMark size={16} color={repo ? c.text : c.text2} />}
            label={repo ? `${repo.repo.split('/')[1]} · ${repo.branch}` : t('code.repo.pick')}
            maxWidth={260}
            onPress={() => setSheet('repo')}
          />
        </ScrollView>

        <View style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: focused ? c.accent : c.lineStrong }}>
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
            placeholder={t('code.composer.placeholder')}
            placeholderTextColor={c.text3}
            cursorColor={c.accent}
            selectionColor={c.accentSoft}
            // Web önizlemesinde tarayıcının odak çerçevesi kartın kendi çerçevesiyle çakışmasın.
            style={[{ fontFamily: fonts.sans, fontSize: 16, lineHeight: 22, color: c.text, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 4, maxHeight: 168, minHeight: 56, textAlignVertical: 'top' }, { outlineStyle: 'none' } as never]}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8 }}>
            <Press haptics="select" scale={0.95} onPress={() => setSheet('model')} style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 17, backgroundColor: c.surface2 }}>
              <Sparkles size={15} color={c.accent} />
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.model')}</RNText>
            </Press>
            <Animated.View style={sendStyle}>
              <Press
                scale={0.9}
                accessibilityLabel={t('code.start')}
                disabled={!canSend}
                onPress={() => void submit()}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: canSend ? c.inverse : c.surface3, alignItems: 'center', justifyContent: 'center' }}
              >
                <ArrowUp size={19} strokeWidth={2.5} color={canSend ? c.onInverse : c.text3} />
              </Press>
            </Animated.View>
          </View>
        </View>
        {repo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
            <GitBranch size={13} color={c.text3} />
            <RNText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
              {t('code.branch.work')}: sixfinger/…
            </RNText>
          </View>
        )}
      </View>

      <RepoSheet visible={sheet === 'repo'} onClose={() => setSheet(null)} current={repo} onPick={(r, b) => setRepo({ repo: r, branch: b })} />
      <EnvSheet visible={sheet === 'env'} onClose={() => setSheet(null)} value={env?.id ?? null} onPick={(e) => setEnvId(e.id)} />
      <ModelSheet visible={sheet === 'model'} onClose={() => setSheet(null)} />
    </KeyboardAvoidingView>
  );
}
