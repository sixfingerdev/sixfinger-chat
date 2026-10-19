import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Trash2 } from 'lucide-react-native';
import { CODE_DISK_DEFAULT_MB, type CodeNetwork } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { formatMb } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useCode } from '../../store/code.ts';
import { useUi } from '../../store/ui.ts';
import { Field } from '../../components/Field.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { Button, Press } from '../../components/Ui.tsx';
import { CodeHeader, NETWORK_ICON } from '../../components/code/CodeUi.tsx';

const NETWORKS: CodeNetwork[] = ['none', 'trusted', 'full', 'custom'];
const DISK_STEPS = [128, 256, 512, 1024, 1536] as const;
const VAR_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** "ANAHTAR=değer" satırlarını nesneye çevirir; biçimi bozuk satır varsa null. */
function parseVars(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!VAR_LINE.test(line)) return null;
    const i = line.indexOf('=');
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const mono = { fontFamily: fonts.mono, fontSize: 14 } as const;

export default function EnvEditor() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);

  const [loading, setLoading] = useState(editing);
  const [name, setName] = useState('');
  const [network, setNetwork] = useState<CodeNetwork>('trusted');
  const [domains, setDomains] = useState('');
  const [setup, setSetup] = useState('');
  const [disk, setDisk] = useState<number>(CODE_DISK_DEFAULT_MB);
  const [vars, setVars] = useState('');
  const [coAuthor, setCoAuthor] = useState(true);
  const [sessionLink, setSessionLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [varsBad, setVarsBad] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .codeEnvironment(id)
      .then(({ environment: e }) => {
        setName(e.name);
        setNetwork(e.network);
        setDomains(e.allowedDomains.join('\n'));
        setSetup(e.setupScript);
        setDisk(e.diskMb);
        setCoAuthor(e.commitCoAuthor ?? true);
        setSessionLink(e.commitSessionLink ?? false);
        setVars(Object.entries(e.envVars ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
        setLoading(false);
      })
      .catch((err) => {
        reportError(err);
        router.back();
      });
  }, [id]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/code'));

  const save = async () => {
    const envVars = parseVars(vars);
    if (!envVars) {
      setVarsBad(true);
      haptic.error();
      return;
    }
    setVarsBad(false);
    setBusy(true);
    const body = {
      name: name.trim(),
      network,
      allowedDomains: network === 'custom' ? domains.split(/[\s,]+/).filter(Boolean) : [],
      setupScript: setup,
      diskMb: disk,
      commitCoAuthor: coAuthor,
      commitSessionLink: sessionLink,
      envVars,
    };
    try {
      const { environment } = id ? await api.codeUpdateEnvironment(id, body) : await api.codeCreateEnvironment(body);
      useCode.getState().upsertEnvironment(environment);
      haptic.success();
      useUi.getState().toast({ kind: 'success', text: t('code.env.saved') });
      back();
    } catch (err) {
      haptic.error();
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    useUi.getState().askConfirm({
      title: t('common.delete'),
      message: t('code.env.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.codeDeleteEnvironment(id!);
          useCode.getState().removeEnvironment(id!);
          haptic.success();
          back();
        } catch (err) {
          reportError(err);
        }
      },
    });

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader
        title={editing ? t('code.env.edit') : t('code.env.new')}
        onBack={back}
        right={
          editing ? (
            <Press accessibilityLabel={t('common.delete')} haptics="tap" scale={0.88} onPress={remove} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={20} color={c.danger} />
            </Press>
          ) : undefined
        }
      />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text3} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 22 }}>
          <Field label={t('code.env.name')} value={name} onChangeText={setName} maxLength={40} autoCapitalize="none" placeholder="Node" />

          <View style={{ gap: 9 }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.env.network')}</RNText>
            <View style={{ gap: 8 }}>
              {NETWORKS.map((n) => {
                const on = network === n;
                const Icon = NETWORK_ICON[n];
                return (
                  <Press
                    key={n}
                    haptics="select"
                    scale={0.985}
                    onPress={() => setNetwork(n)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : c.surface, borderWidth: 1.5, borderColor: on ? c.accent : c.line }}
                  >
                    <Icon size={20} color={on ? c.accent : c.text2} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>{t(`code.env.network.${n}` as 'code.env.network.none')}</RNText>
                      <RNText style={[type.small, { color: c.text3 }]}>{t(`code.env.network.${n}Hint` as 'code.env.network.noneHint')}</RNText>
                    </View>
                    {on && <Check size={18} color={c.accent} />}
                  </Press>
                );
              })}
            </View>
          </View>

          {network === 'custom' && (
            <Field
              label={t('code.env.domains')}
              hint={t('code.env.domainsHint')}
              value={domains}
              onChangeText={setDomains}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={'registry.npmjs.org\n*.github.com'}
              style={mono}
            />
          )}

          <Field label={t('code.env.setup')} hint={t('code.env.setupHint')} value={setup} onChangeText={setSetup} multiline maxLength={4000} autoCapitalize="none" autoCorrect={false} placeholder="npm ci" style={mono} />

          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.env.disk')}</RNText>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>{formatMb(disk, locale)}</RNText>
            </View>
            <Segmented<string>
              value={String(DISK_STEPS.includes(disk as never) ? disk : CODE_DISK_DEFAULT_MB)}
              onChange={(v) => setDisk(Number(v))}
              options={DISK_STEPS.map((d) => ({ id: String(d), label: formatMb(d, locale) }))}
            />
            <RNText style={{ fontFamily: fonts.sans, fontSize: 12.5, color: c.text3 }}>{t('code.env.diskHint')}</RNText>
          </View>

          <View style={{ gap: 12 }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.env.attribution')}</RNText>
            {(
              [
                [coAuthor, setCoAuthor, 'code.env.coauthor', 'code.env.coauthorHint'],
                [sessionLink, setSessionLink, 'code.env.sessionLink', 'code.env.sessionLinkHint'],
              ] as const
            ).map(([on, set, label, hint]) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14.5, color: c.text }}>{t(label)}</RNText>
                  <RNText style={{ fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.text3 }}>{t(hint)}</RNText>
                </View>
                <Switch
                  value={on}
                  onValueChange={(v) => {
                    haptic.select?.();
                    set(v);
                  }}
                  trackColor={{ false: c.line, true: c.accent }}
                  thumbColor={on ? c.onAccent : c.text3}
                />
              </View>
            ))}
          </View>

          <Field
            label={t('code.env.vars')}
            hint={varsBad ? t('code.env.varsInvalid') : t('code.env.varsHint')}
            error={varsBad}
            value={vars}
            onChangeText={(v) => {
              setVars(v);
              if (varsBad) setVarsBad(false);
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={'API_KEY=...'}
            style={mono}
          />
        </ScrollView>
      )}
      {!loading && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 4, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg }}>
          <Button label={t('common.save')} loading={busy} disabled={!name.trim()} onPress={() => void save()} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
