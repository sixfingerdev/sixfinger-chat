import { useEffect, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Check, CircleAlert, X } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api, ApiError } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';
import { Field } from '../components/Field.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { Button, Press } from '../components/Ui.tsx';

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

export default function AuthScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const smtpEnabled = useUi((s) => s.config?.smtpEnabled);
  const user = useAuth((s) => s.user);
  const [m, setM] = useState<Mode>(params.mode ?? 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Doğrulama ekranı sonradan (uyarı, menü) açılınca kimse kod göndermemiştir: kendiliğinden gönder. Az önce gönderildiyse (429) kalan beklemeyi göster.
  useEffect(() => {
    if (params.mode !== 'verify' || !user || user.isGuest || user.emailVerified) return;
    let alive = true;
    api
      .resendVerify()
      .then(() => alive && (setCooldown(45), setInfo(t('auth.resent'))))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 429) {
          setCooldown((err.details as { retryAfter?: number } | undefined)?.retryAfter ?? 45);
          setInfo(t('auth.resent'));
        } else setError(err instanceof ApiError ? err.message : t('error.generic'));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((x) => x - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const go = (next: Mode) => {
    haptic.select();
    setM(next);
    setError(null);
    setInfo(null);
  };
  const verifyEmail = user?.email ?? email;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      haptic.error();
      setError(err instanceof ApiError ? err.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (m === 'login') {
        await useAuth.getState().login(email.trim(), password);
        haptic.success();
        close();
      } else if (m === 'register') {
        await useAuth.getState().register({ email: email.trim(), password, displayName: name.trim() || undefined });
        setCooldown(45);
        setM('verify');
      } else if (m === 'verify') {
        const { user: u } = await api.verify(code);
        useAuth.getState().setUser(u);
        haptic.success();
        useUi.getState().toast({ kind: 'success', text: t('auth.verifyDone') });
        close();
      } else if (m === 'forgot') {
        await api.forgot(email.trim());
        setCooldown(45);
        setM('reset');
      } else if (m === 'reset') {
        await api.reset({ email: email.trim(), code, password });
        setPassword('');
        setM('login');
        setInfo(t('auth.resetDone'));
      }
    });

  const resend = () =>
    run(async () => {
      if (m === 'verify') await api.resendVerify();
      else await api.forgot(email.trim());
      setCooldown(45);
      setInfo(t('auth.resent'));
    });

  const titles: Record<Mode, [string, string]> = {
    login: [t('auth.signInTitle'), t('auth.signInSub')],
    register: [t('auth.signUpTitle'), t('auth.signUpSub')],
    verify: [t('auth.verifyTitle'), t('auth.verifySub', { email: verifyEmail })],
    forgot: [t('auth.forgotTitle'), t('auth.forgotSub')],
    reset: [t('auth.resetTitle'), t('auth.resetSub', { email })],
  };
  const [title, sub] = titles[m];
  const needsCode = m === 'verify' || m === 'reset';
  const label = { login: t('auth.signIn'), register: t('auth.signUp'), verify: t('auth.verifyDo'), forgot: t('auth.sendCode'), reset: t('auth.resetDo') }[m];

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8, height: 56 + insets.top }}>
        <Press accessibilityLabel={t('common.close')} haptics="tap" scale={0.88} onPress={close} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
          <X size={22} color={c.text2} />
        </Press>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 24, gap: 18 }}>
        <View style={{ gap: 14 }}>
          <LogoMark size={34} animate={busy} />
          <RNText style={[type.title, { fontSize: 26, lineHeight: 32, color: c.text }]}>{title}</RNText>
          <RNText style={[type.body, { color: c.text2 }]}>{sub}</RNText>
        </View>

        {info && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: c.accentSoft }}>
            <Check size={16} color={c.accent} />
            <RNText style={[type.small, { color: c.text, flex: 1 }]}>{info}</RNText>
          </View>
        )}
        {error && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.md, backgroundColor: c.dangerSoft }}>
            <CircleAlert size={16} color={c.danger} style={{ marginTop: 2 }} />
            <RNText style={[type.small, { color: c.danger, flex: 1 }]}>{error}</RNText>
          </View>
        )}

        {(m === 'login' || m === 'register' || m === 'forgot' || m === 'reset') && (
          <Field
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={m !== 'reset'}
            placeholder="ornek@eposta.com"
          />
        )}
        {m === 'register' && <Field label={t('auth.name')} value={name} onChangeText={setName} maxLength={60} autoComplete="name" />}
        {needsCode && (
          <Field
            label={t('auth.code')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            style={{ fontFamily: fonts.mono, letterSpacing: 8, fontSize: 20 }}
            hint={smtpEnabled === false ? 'SMTP kapalı: kod sunucu loguna yazıldı.' : undefined}
          />
        )}
        {(m === 'login' || m === 'register' || m === 'reset') && (
          <Field
            label={m === 'login' ? t('auth.password') : t('auth.passwordNew')}
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoComplete={m === 'login' ? 'current-password' : 'new-password'}
            maxLength={128}
          />
        )}

        <Button label={label} loading={busy} disabled={needsCode && code.length !== 6} onPress={() => void submit()} style={{ height: 52 }} />

        {needsCode && (
          <Press disabled={busy || cooldown > 0} onPress={() => void resend()} haptics="tap" style={{ alignSelf: 'center', padding: 8 }}>
            <RNText style={[type.small, { color: cooldown > 0 ? c.text3 : c.accent, fontFamily: fonts.sansSemibold }]}>
              {cooldown > 0 ? t('auth.resendWait', { n: cooldown }) : t('auth.resend')}
            </RNText>
          </Press>
        )}

        <View style={{ alignItems: 'center', gap: 6 }}>
          {m === 'login' && (
            <>
              <Press onPress={() => go('forgot')} style={{ padding: 6 }}>
                <RNText style={[type.small, { color: c.text2 }]}>{t('auth.forgot')}</RNText>
              </Press>
              <Press onPress={() => go('register')} style={{ padding: 6 }}>
                <RNText style={[type.small, { color: c.text2 }]}>
                  {t('auth.noAccount')} <RNText style={{ color: c.accent, fontFamily: fonts.sansSemibold }}>{t('auth.signUp')}</RNText>
                </RNText>
              </Press>
            </>
          )}
          {m === 'register' && (
            <Press onPress={() => go('login')} style={{ padding: 6 }}>
              <RNText style={[type.small, { color: c.text2 }]}>
                {t('auth.haveAccount')} <RNText style={{ color: c.accent, fontFamily: fonts.sansSemibold }}>{t('auth.signIn')}</RNText>
              </RNText>
            </Press>
          )}
          {(m === 'forgot' || m === 'reset') && (
            <Press onPress={() => go('login')} style={{ padding: 6 }}>
              <RNText style={[type.small, { color: c.text2 }]}>{t('common.back')}</RNText>
            </Press>
          )}
          {m === 'verify' && (
            <Press onPress={close} style={{ padding: 6 }}>
              <RNText style={[type.small, { color: c.text2 }]}>{t('auth.later')}</RNText>
            </Press>
          )}
        </View>

        {(m === 'login' || m === 'register') && user?.isGuest && (
          <View style={{ gap: 12 }}>
            <RNText style={[type.small, { color: c.text3, textAlign: 'center' }]}>{m === 'register' ? t('auth.guestLoses') : t('auth.guestNote')}</RNText>
            <Button label={t('auth.guestContinue')} variant="secondary" onPress={close} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
