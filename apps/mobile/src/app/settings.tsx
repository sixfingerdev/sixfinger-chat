import { useEffect, useState, type ReactNode } from 'react';
import { Alert, ScrollView, Switch, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Constants from 'expo-constants';
import { ChevronLeft, ChevronRight, Lock, Trash2, X } from 'lucide-react-native';
import { PERSONAS, type MemoryDTO, type SessionDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api, ApiError, getApiBase } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { shareText } from '../lib/export.ts';
import { timeUntil } from '../lib/format.ts';
import { setLocale, useLocale, useT, type Locale } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi, type ThemePref } from '../store/ui.ts';
import { Field } from '../components/Field.tsx';
import { Segmented } from '../components/Segmented.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { Button, Press } from '../components/Ui.tsx';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <RNText style={[type.label, { color: c.text3, paddingHorizontal: 4 }]}>{title}</RNText>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: 16, gap: 16 }}>{children}</View>
    </View>
  );
}

function Row({ label, hint, right, onPress }: { label: string; hint?: string; right?: ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 }}>
      <View style={{ flex: 1 }}>
        <RNText style={[type.body, { color: c.text }]}>{label}</RNText>
        {hint && <RNText style={[type.small, { color: c.text3 }]}>{hint}</RNText>}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Press haptics="tap" scale={0.99} onPress={onPress}>
      {body}
    </Press>
  ) : (
    body
  );
}

export default function SettingsScreen() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user)!;
  const config = useUi((s) => s.config);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const guest = user.isGuest;
  const member = user.tier === 'member';

  const [form, setForm] = useState({ customName: user.settings.customName, about: user.settings.about, instructions: user.settings.instructions, defaultPersona: user.settings.defaultPersona });
  const [busy, setBusy] = useState(false);
  const [memories, setMemories] = useState<MemoryDTO[] | null>(null);
  const [memText, setMemText] = useState('');
  const [sessions, setSessions] = useState<SessionDTO[] | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [delPass, setDelPass] = useState('');

  useEffect(() => {
    if (!guest) {
      api.memories().then((r) => setMemories(r.memories)).catch(() => setMemories([]));
      api.sessions().then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
    }
  }, [guest]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const dirty = form.customName !== user.settings.customName || form.about !== user.settings.about || form.instructions !== user.settings.instructions || form.defaultPersona !== user.settings.defaultPersona;

  const chooseLocale = async (l: Locale) => {
    setLocale(l, true);
    try {
      const { user: u } = await api.updateMe({ locale: l });
      useAuth.setState({ user: u });
    } catch {
      /* dil yerelde değişti */
    }
  };

  const savePersonal = async () => {
    setBusy(true);
    try {
      const { user: u } = await api.updateMe({ settings: form });
      useAuth.getState().setUser(u);
      haptic.success();
      useUi.getState().toast({ kind: 'success', text: t('common.saved') });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title: string, run: () => void, destructive = true) =>
    Alert.alert(title, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: destructive ? 'destructive' : 'default', onPress: run },
    ]);

  const used = config?.usage.used ?? 0;
  const limit = config?.usage.limit ?? 1;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top, height: 56 + insets.top, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 }}>
        <Press accessibilityLabel={t('common.back')} haptics="tap" scale={0.88} onPress={close} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
          <ChevronLeft size={24} color={c.text} />
        </Press>
        <RNText style={[type.heading as never, { color: c.text, flex: 1 }]}>{t('settings.title')}</RNText>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 22 }}>
        {/* Hesap */}
        <Section title={t('settings.account')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ flex: 1 }}>
              <RNText style={[type.heading as never, { color: c.text }]}>{user.displayName}</RNText>
              {!guest && <RNText style={[type.small, { color: c.text3 }]}>{user.email}</RNText>}
            </View>
            <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: member ? c.accentSoft : c.surface3, justifyContent: 'center' }}>
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 12, color: member ? c.accent : c.text2 }}>{t(`tier.${user.tier}` as 'tier.guest')}</RNText>
            </View>
          </View>
          {guest ? (
            <View style={{ gap: 10 }}>
              <Button label={t('auth.signUp')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'register' } })} />
              <Button label={t('auth.signIn')} variant="secondary" onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } })} />
            </View>
          ) : (
            <>
              {!user.emailVerified && <Button label={t('banner.verifyAction')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'verify' } })} />}
              <Button
                label={t('settings.signOut')}
                variant="secondary"
                onPress={() =>
                  confirm(t('settings.signOut'), async () => {
                    await useAuth.getState().logout();
                    close();
                  }, false)
                }
              />
            </>
          )}
        </Section>

        {/* Kullanım */}
        {config && (
          <Section title={t('settings.usageToday')}>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <RNText style={{ fontFamily: fonts.mono, fontSize: 14, color: c.text }}>
                  {used} / {limit}
                </RNText>
                <RNText style={[type.small, { color: c.text3 }]}>{t('settings.usageResets', { time: timeUntil(config.usage.resetsAt, locale) })}</RNText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface3, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, (used / limit) * 100)}%`, height: '100%', backgroundColor: used >= limit ? c.danger : c.accent, transform: [{ skewX: '-24deg' }] }} />
              </View>
            </View>
          </Section>
        )}

        {/* Görünüm */}
        <Section title={t('settings.general')}>
          <View style={{ gap: 8 }}>
            <RNText style={[type.small, { color: c.text2 }]}>{t('settings.theme')}</RNText>
            <Segmented<ThemePref>
              value={theme}
              onChange={setTheme}
              options={[
                { id: 'dark', label: t('settings.theme.dark') },
                { id: 'light', label: t('settings.theme.light') },
                { id: 'system', label: t('settings.theme.system') },
              ]}
            />
          </View>
          <View style={{ gap: 8 }}>
            <RNText style={[type.small, { color: c.text2 }]}>{t('settings.language')}</RNText>
            <Segmented<Locale>
              value={locale}
              onChange={(l) => void chooseLocale(l)}
              options={[
                { id: 'tr', label: 'Türkçe' },
                { id: 'en', label: 'English' },
              ]}
            />
          </View>
        </Section>

        {/* Kişiselleştirme */}
        <Section title={t('settings.personal')}>
          {guest ? (
            <Row label={t('settings.guestLocked')} right={<Lock size={16} color={c.text3} />} />
          ) : (
            <>
              <Field label={t('settings.name')} hint={t('settings.nameHint')} value={form.customName} onChangeText={(v) => setForm({ ...form, customName: v })} maxLength={60} />
              <Field label={t('settings.about')} hint={t('settings.aboutHint')} value={form.about} onChangeText={(v) => setForm({ ...form, about: v })} multiline maxLength={600} />
              <Field label={t('settings.instructions')} hint={t('settings.instructionsHint')} value={form.instructions} onChangeText={(v) => setForm({ ...form, instructions: v })} multiline maxLength={1200} />
              <View style={{ gap: 8 }}>
                <RNText style={[type.small, { color: c.text2 }]}>{t('settings.defaultPersona')}</RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {PERSONAS.map((p) => {
                    const on = form.defaultPersona === p.id;
                    return (
                      <Press
                        key={p.id}
                        haptics="select"
                        scale={0.96}
                        onPress={() => setForm({ ...form, defaultPersona: p.id })}
                        style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: on ? c.accentSoft : c.surface2, borderWidth: 1, borderColor: on ? c.accent : c.line }}
                      >
                        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: on ? c.accent : c.text2 }}>{p.name[locale]}</RNText>
                      </Press>
                    );
                  })}
                </View>
              </View>
              <Button label={t('common.save')} loading={busy} disabled={!dirty} onPress={() => void savePersonal()} />
            </>
          )}
        </Section>

        {/* Hafıza */}
        <Section title={t('settings.memory')}>
          {guest || !user.emailVerified ? (
            <Row label={t('settings.memoryLocked')} right={<Lock size={16} color={c.text3} />} />
          ) : (
            <>
              <Row
                label={t('settings.memoryOn')}
                hint={t('settings.memoryHint')}
                right={
                  <Switch
                    value={user.settings.memoryEnabled}
                    trackColor={{ false: c.surface3, true: c.accent }}
                    thumbColor="#fff"
                    onValueChange={async (v) => {
                      haptic.select();
                      try {
                        const { user: u } = await api.updateMe({ settings: { memoryEnabled: v } });
                        useAuth.setState({ user: u });
                      } catch (err) {
                        reportError(err);
                      }
                    }}
                  />
                }
              />
              <Field
                value={memText}
                onChangeText={setMemText}
                placeholder={t('settings.memoryPlaceholder')}
                maxLength={300}
                returnKeyType="done"
                onSubmitEditing={async () => {
                  if (!memText.trim()) return;
                  try {
                    const { memory } = await api.addMemory(memText.trim());
                    setMemories((cur) => [memory, ...(cur ?? []).filter((m) => m.id !== memory.id)]);
                    setMemText('');
                    haptic.success();
                  } catch (err) {
                    reportError(err);
                  }
                }}
              />
              {memories?.length === 0 && <RNText style={[type.small, { color: c.text3 }]}>{t('settings.memoryEmpty')}</RNText>}
              {memories?.map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <RNText style={[type.body, { flex: 1, color: c.text, fontSize: 14.5 }]}>{m.content}</RNText>
                  <Press
                    accessibilityLabel={t('common.delete')}
                    haptics="tap"
                    scale={0.85}
                    hitSlop={8}
                    onPress={async () => {
                      try {
                        await api.deleteMemory(m.id);
                        setMemories((cur) => (cur ?? []).filter((x) => x.id !== m.id));
                      } catch (err) {
                        reportError(err);
                      }
                    }}
                    style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={16} color={c.text3} />
                  </Press>
                </View>
              ))}
              {!!memories?.length && (
                <Button
                  label={t('settings.memoryClear')}
                  variant="danger"
                  onPress={() =>
                    confirm(t('settings.memoryClear'), async () => {
                      try {
                        await api.clearMemories();
                        setMemories([]);
                      } catch (err) {
                        reportError(err);
                      }
                    })
                  }
                />
              )}
            </>
          )}
        </Section>

        {/* Veri */}
        <Section title={t('settings.data')}>
          <Row
            label={t('settings.exportAll')}
            hint={t('settings.exportAllHint')}
            right={<ChevronRight size={18} color={c.text3} />}
            onPress={async () => {
              try {
                await shareText('SixFinger', JSON.stringify(await api.exportAll(), null, 2));
              } catch (err) {
                reportError(err);
              }
            }}
          />
          <Row
            label={t('settings.deleteChats')}
            hint={t('settings.deleteChatsHint')}
            right={<Trash2 size={17} color={c.danger} />}
            onPress={() =>
              confirm(t('settings.deleteChatsConfirm'), async () => {
                try {
                  await api.deleteAllChats();
                  useChats.getState().reset();
                  await useChats.getState().loadChats();
                  haptic.success();
                  useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
                  close();
                } catch (err) {
                  reportError(err);
                }
              })
            }
          />
        </Section>

        {/* Güvenlik */}
        {!guest && (
          <Section title={t('settings.changePassword')}>
            <Field label={t('settings.currentPassword')} value={cur} onChangeText={setCur} secure autoCapitalize="none" />
            <Field label={t('settings.newPassword')} value={next} onChangeText={setNext} secure autoCapitalize="none" />
            <Button
              label={t('settings.changePassword')}
              disabled={!cur || next.length < 8}
              onPress={async () => {
                try {
                  await api.changePassword({ currentPassword: cur, newPassword: next });
                  setCur('');
                  setNext('');
                  haptic.success();
                  useUi.getState().toast({ kind: 'success', text: t('settings.passwordChanged') });
                  api.sessions().then((r) => setSessions(r.sessions)).catch(() => {});
                } catch (err) {
                  reportError(err);
                }
              }}
            />
            {!!sessions?.length && (
              <View style={{ gap: 10, marginTop: 4 }}>
                <RNText style={[type.label, { color: c.text3 }]}>{t('settings.sessions')}</RNText>
                {sessions.map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <RNText numberOfLines={1} style={[type.small, { color: c.text }]}>
                        {s.userAgent?.slice(0, 40) ?? '—'}
                      </RNText>
                      <RNText style={[type.small, { color: c.text3, fontSize: 12 }]}>{s.current ? t('settings.sessionCurrent') : new Date(s.lastUsedAt).toLocaleDateString()}</RNText>
                    </View>
                    {!s.current && (
                      <Press
                        haptics="tap"
                        onPress={async () => {
                          try {
                            await api.revokeSession(s.id);
                            setSessions((l) => (l ?? []).filter((x) => x.id !== s.id));
                          } catch (err) {
                            reportError(err);
                          }
                        }}
                      >
                        <RNText style={[type.small, { color: c.danger, fontFamily: fonts.sansSemibold }]}>{t('settings.revoke')}</RNText>
                      </Press>
                    )}
                  </View>
                ))}
              </View>
            )}
          </Section>
        )}

        {/* Sunucu + sürüm */}
        <Section title="SixFinger">
          <Row label={t('server.current')} hint={getApiBase()} right={<ChevronRight size={18} color={c.text3} />} onPress={() => router.push('/connect')} />
          <Row label="Sürüm" hint={`${Constants.expoConfig?.version ?? '—'}`} />
        </Section>

        {!guest && (
          <Button
            label={t('settings.deleteAccount')}
            variant="danger"
            onPress={() => setDeleteOpen(true)}
          />
        )}
      </ScrollView>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <View style={{ paddingHorizontal: 18, paddingBottom: 8, gap: 14 }}>
          <RNText style={[type.heading as never, { color: c.text }]}>{t('settings.deleteAccount')}</RNText>
          <RNText style={[type.small, { color: c.text2 }]}>{t('settings.deleteAccountConfirm')}</RNText>
          <Field label={t('auth.password')} value={delPass} onChangeText={setDelPass} secure autoCapitalize="none" />
          <Button
            label={t('settings.deleteAccount')}
            variant="danger"
            disabled={!delPass}
            onPress={async () => {
              try {
                await api.deleteMe(delPass);
                setDeleteOpen(false);
                await useAuth.getState().logout(true);
                close();
              } catch (e) {
                haptic.error();
                useUi.getState().toast({ kind: 'error', text: e instanceof ApiError ? e.message : t('error.generic') });
              }
            }}
          />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
