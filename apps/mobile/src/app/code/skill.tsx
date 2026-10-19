import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, Switch, Text as RNText, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Trash2 } from 'lucide-react-native';
import { serializeSkillMd, type SkillDetailDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useUi } from '../../store/ui.ts';
import { Button, Press } from '../../components/Ui.tsx';
import { CodeHeader } from '../../components/code/CodeUi.tsx';

type FileRow = { path: string; content: string };
const mono = { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 } as const;

/** Skill görüntüle / düzenle: SKILL.md metni + ek dosyalar; yerleşikler salt okunur ("kopyala ve düzenle"). */
export default function SkillEditor() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { name, source } = useLocalSearchParams<{ name?: string; source?: string }>();
  const readonly = source === 'builtin';
  const [detail, setDetail] = useState<SkillDetailDTO | null>(null);
  const [markdown, setMarkdown] = useState(
    name ? '' : serializeSkillMd({ name: 'yeni-skill', description: `Ne yaptığı ve ne zaman kullanılacağı. ${t('code.skills.template')}`, triggers: ['anahtar', 'keyword'], body: '# Başlık\n\n1. Birinci adım.\n2. İkinci adım.\n3. Doğrula: testleri çalıştır.\n\nYapma:\n- …' }),
  );
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/code/skills' as never));

  useEffect(() => {
    if (!name) return;
    api
      .codeSkill(name, readonly ? 'builtin' : undefined)
      .then((d) => {
        setDetail(d);
        setMarkdown(d.markdown);
        setFiles(Object.entries(d.files).map(([path, content]) => ({ path, content })));
      })
      .catch((err) => {
        reportError(err);
        back();
      });
  }, [name, readonly]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (asName: string | null) => {
    setBusy(true);
    setError('');
    try {
      await api.codeSaveSkill(asName, { markdown, files: Object.fromEntries(files.filter((f) => f.path.trim()).map((f) => [f.path.trim(), f.content])) });
      haptic.success();
      useUi.getState().toast({ kind: 'success', text: t('code.skills.saved') });
      back();
    } catch (err) {
      haptic.error();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    useUi.getState().askConfirm({
      title: t('common.delete'),
      message: t('code.skills.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.codeDeleteSkill(name!);
          haptic.success();
          back();
        } catch (err) {
          reportError(err);
        }
      },
    });

  const toggleShare = async (on: boolean) => {
    if (!name || !detail) return;
    try {
      const r = await api.codeShareSkill(name, on);
      setDetail({ ...detail, shareToken: r.shareToken });
      if (r.shareToken) void Share.share({ message: `https://chat.sixfinger.live/code/skills?import=${r.shareToken}` });
    } catch (err) {
      reportError(err);
    }
  };

  const input = { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, padding: 12, color: c.text, textAlignVertical: 'top' as const };
  const loading = Boolean(name) && !detail;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={name ? (readonly ? `${t('code.skills.view')}: ${name}` : t('code.skills.edit')) : t('code.skills.new')} onBack={back} />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.text3} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 90 }}>
          {readonly && <RNText style={[type.small, { color: c.text3 }]}>{t('code.skills.copyHint')}</RNText>}
          <View style={{ gap: 7 }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.skills.markdown')}</RNText>
            <TextInput value={markdown} onChangeText={setMarkdown} multiline editable={!readonly} autoCapitalize="none" autoCorrect={false} spellCheck={false} style={[input, mono, { minHeight: 280 }]} cursorColor={c.accent} />
            {!readonly && <RNText style={[type.small, { color: c.text3 }]}>{t('code.skills.markdownHint')}</RNText>}
          </View>

          <View style={{ gap: 8 }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{t('code.skills.files')}</RNText>
            {!readonly && <RNText style={[type.small, { color: c.text3 }]}>{t('code.skills.filesHint')}</RNText>}
            {files.map((f, i) => (
              <View key={i} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <TextInput value={f.path} editable={!readonly} onChangeText={(v) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, path: v } : x)))} placeholder={t('code.skills.filePath')} placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} style={[input, mono, { flex: 1, padding: 10 }]} />
                  {!readonly && (
                    <Press accessibilityLabel={t('common.delete')} haptics="tap" scale={0.88} onPress={() => setFiles((cur) => cur.filter((_, j) => j !== i))} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={17} color={c.text2} />
                    </Press>
                  )}
                </View>
                <TextInput value={f.content} editable={!readonly} onChangeText={(v) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, content: v } : x)))} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} style={[input, mono, { minHeight: 110 }]} />
              </View>
            ))}
            {!readonly && (
              <Press haptics="tap" scale={0.97} onPress={() => setFiles((cur) => [...cur, { path: '', content: '' }])} style={{ alignSelf: 'flex-start', height: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: c.surface2 }}>
                <Plus size={15} color={c.text} />
                <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: c.text }}>{t('code.skills.addFile')}</RNText>
              </Press>
            )}
          </View>

          {name && !readonly && detail && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14.5, color: c.text }}>{t('code.skills.share')}</RNText>
                {!!detail.shareToken && <RNText style={[type.small, { color: c.text3 }]}>{t('code.skills.shareOn')}</RNText>}
              </View>
              <Switch value={Boolean(detail.shareToken)} onValueChange={(v) => void toggleShare(v)} trackColor={{ true: c.accent, false: c.surface3 }} />
            </View>
          )}
          {!!error && <RNText style={[type.small, { color: c.danger }]}>{error}</RNText>}

          <View style={{ gap: 10 }}>
            {!readonly && <Button label={t('common.save')} loading={busy} onPress={() => void save(name ?? null)} />}
            {name && !readonly && <Button label={t('common.delete')} variant="ghost" onPress={remove} />}
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
