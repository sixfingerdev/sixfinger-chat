import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ellipsis, GitPullRequest, Trash2 } from 'lucide-react-native';
import { radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useChats } from '../../store/chats.ts';
import { useCode } from '../../store/code.ts';
import { useUi } from '../../store/ui.ts';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Press } from '../../components/Ui.tsx';
import { CodeHeader } from '../../components/code/CodeUi.tsx';
import { DiffSheet } from '../../components/code/CodeGitSheets.tsx';
import { CodeComposer } from '../../components/code/CodeComposer.tsx';
import { CodeSheetHost, type SheetTarget } from '../../components/code/CodeParts.tsx';
import { ChangesSheet, ContextRing, PullsSheet, UsageSheet } from '../../components/code/CodeSheets.tsx';
import { CodeThread } from '../../components/code/CodeThread.tsx';

/** Code oturumu: mesajlar, gruplanmış komutlar, dosya çipleri, bağlam halkası, PR ve değişiklik sayfaları. */
export default function CodeSession() {
  const { c } = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useCode((s) => s.sessions?.find((x) => x.chatId === id));
  const hasDetail = useChats((s) => Boolean(id && s.detail[id]));
  const generating = useChats((s) => Boolean(id && s.generating[id]));
  const loadError = useChats((s) => s.loadError);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'usage' | 'pulls' | 'changes' | null>(null);
  const [diff, setDiff] = useState<{ path?: string } | null>(null);
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [missing, setMissing] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/code'));

  const loadSession = useCallback(() => {
    if (!id) return Promise.resolve();
    return api
      .codeSession(id)
      .then(({ session: s }) => useCode.getState().upsertSession(s))
      .catch((err) => {
        if (!useCode.getState().sessions?.some((x) => x.chatId === id)) setMissing(true);
        reportError(err);
      });
  }, [id]);

  // Açılışta oturum ve mesajlar (sessiz: ana sohbetin etkin kimliğine dokunmaz). Sunucuda süren bir tur varsa canlı izlenir.
  useEffect(() => {
    if (!id) return;
    void loadSession();
    void useChats.getState().openChat(id, true);
    void useCode.getState().loadStatus().catch(() => {});
  }, [id, loadSession]);

  // Tur bitince oturum bilgisi (başlık, disk, toplam değişiklik) sunucudan tazelenir.
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && !generating) void loadSession();
    wasGenerating.current = generating;
  }, [generating, loadSession]);

  // Uygulama arka plandan dönünce akışı yeniden bağla.
  useEffect(() => {
    if (!id) return;
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') leftAt = Date.now();
      else if (st === 'active' && leftAt && Date.now() - leftAt > 4_000) {
        leftAt = 0;
        useChats.getState().refresh(id);
        void loadSession();
      }
    });
    return () => sub.remove();
  }, [id, loadSession]);

  // Yeni-oturum ekranında yazılan ilk görev: mesajlar yüklenince bir kez gönderilir.
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!id || !hasDetail || generating || sentFirst.current) return;
    const text = useCode.getState().takePendingPrompt(id);
    if (text === undefined) return;
    sentFirst.current = true;
    void useChats.getState().send({ content: text, chatId: id });
  }, [id, hasDetail, generating]);

  const remove = () =>
    useUi.getState().askConfirm({
      title: t('code.session.delete'),
      message: t('code.session.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          if (id && useChats.getState().generating[id]) useChats.getState().stop(id);
          await api.codeDeleteSession(id!);
          useCode.getState().removeSession(id!);
          haptic.success();
          back();
        } catch (err) {
          reportError(err);
        }
      },
    });

  if (!id) return null;
  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <CodeHeader title="" onBack={back} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 }}>
          {missing ? (
            <>
              <RNText style={[type.heading as never, { color: c.text }]}>{loadError === 'notfound' ? t('chat.notFound') : t('error.generic')}</RNText>
              <Button label={t('common.back')} onPress={back} />
            </>
          ) : (
            <ActivityIndicator color={c.text3} />
          )}
        </View>
      </View>
    );
  }

  const shortRepo = session.repo.split('/')[1] ?? session.repo;
  const title = session.title === 'Yeni oturum' ? t('code.session.untitled') : session.title;
  const iconBtn = { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader
        title={title}
        subtitle={`${shortRepo}${session.environmentName ? ` · ${session.environmentName}` : ''}`}
        onBack={back}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Press accessibilityLabel={t('code.usage.title')} haptics="tap" scale={0.88} onPress={() => setSheet('usage')} style={iconBtn}>
              <ContextRing tokens={session.contextTokens} limit={session.contextLimit} />
            </Press>
            <Press accessibilityLabel={t('code.pr.title')} haptics="tap" scale={0.88} onPress={() => setSheet('pulls')} style={iconBtn}>
              <GitPullRequest size={20} color={c.text} />
            </Press>
            <Press accessibilityLabel={t('code.session.menu')} haptics="tap" scale={0.88} onPress={() => setMenu(true)} style={iconBtn}>
              <Ellipsis size={22} color={c.text} />
            </Press>
          </View>
        }
      />

      <View style={{ flex: 1 }}>
        <CodeThread chatId={id} onOpen={setTarget} />
      </View>

      <CodeComposer session={session} ready={hasDetail} onChanges={() => setSheet('changes')} />

      <CodeSheetHost chatId={id} target={target} onClose={() => setTarget(null)} />
      <UsageSheet visible={sheet === 'usage'} onClose={() => setSheet(null)} tokens={session.contextTokens} limit={session.contextLimit} />
      <PullsSheet visible={sheet === 'pulls'} onClose={() => setSheet(null)} chatId={id} onChanged={() => { void loadSession(); void useChats.getState().openChat(id, true); }} />
      <ChangesSheet visible={sheet === 'changes'} onClose={() => setSheet(null)} chatId={id} additions={session.additions} deletions={session.deletions} files={session.filesChanged} onDiff={(path) => setDiff({ path })} />
      <DiffSheet visible={Boolean(diff)} onClose={() => setDiff(null)} chatId={id} path={diff?.path} />

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
    </KeyboardAvoidingView>
  );
}
