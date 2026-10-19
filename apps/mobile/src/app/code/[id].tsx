import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text as RNText, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { BookOpen, Download, Ellipsis, FolderOpen, GitPullRequest, Plug } from 'lucide-react-native';
import { Linking } from 'react-native';
import { codeTranscriptMarkdown, type CodePullDTO } from '@sixfinger/shared';
import { fonts, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { selectPath, useChats } from '../../store/chats.ts';
import { useCode } from '../../store/code.ts';
import { useUi } from '../../store/ui.ts';
import { Button, Press } from '../../components/Ui.tsx';
import { CodeHeader } from '../../components/code/CodeUi.tsx';
import { MenuItem, SessionMenu } from '../../components/code/SessionMenu.tsx';
import { shareText } from '../../lib/export.ts';
import { DiffSheet, FilesSheet } from '../../components/code/CodeGitSheets.tsx';
import { CodeComposer } from '../../components/code/CodeComposer.tsx';
import { CodeSheetHost, type SheetTarget } from '../../components/code/CodeParts.tsx';
import { ChangesSheet, ContextRing, PullsSheet, UsageSheet } from '../../components/code/CodeSheets.tsx';
import { CodeThread } from '../../components/code/CodeThread.tsx';
import { CodeRunStatus } from '../../components/code/CodeRunStatus.tsx';
import type { MessageActions } from '../../components/code/CodeCards.tsx';

/** Code oturumu: mesajlar, gruplanmış komutlar, dosya çipleri, bağlam halkası, PR ve değişiklik sayfaları. */
export default function CodeSession() {
  const { c } = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useCode((s) => s.sessions?.find((x) => x.chatId === id) ?? s.archived?.find((x) => x.chatId === id));
  const hasDetail = useChats((s) => Boolean(id && s.detail[id]));
  const generating = useChats((s) => Boolean(id && s.generating[id]));
  const loadError = useChats((s) => s.loadError);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'usage' | 'pulls' | 'changes' | null>(null);
  const [diff, setDiff] = useState<{ path?: string } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [missing, setMissing] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [pr, setPr] = useState<CodePullDTO | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const run = useChats((s) => (id ? s.codeRun[id] : undefined));
  /** Üretilen yanıtın sunucuda oluşturulma zamanı: sunucu evre süresi göndermese bile sayaç yeniden açılışta sıfırlanmaz. */
  const streamingSince = useChats((s) => {
    const m = id ? s.detail[id]?.messages.find((x) => x.id === s.generating[id]?.assistantId) : undefined;
    const t = m ? Date.parse(m.createdAt) : NaN;
    return Number.isFinite(t) && t <= Date.now() && Date.now() - t < 6 * 3_600_000 ? t : 0;
  });
  const runningTasks = useChats((s) => {
    const m = id ? s.detail[id]?.messages.find((x) => x.id === s.generating[id]?.assistantId) : undefined;
    return m ? (m.parts ?? []).filter((p) => p.type === 'tool' && p.name === 'task' && p.status === 'running').length : 0;
  });

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
  useEffect(() => setStartedAt(generating ? Date.now() : 0), [generating]);

  // Alttaki PR çipi: oturumun PR'ının güncel durumu (açık/birleştirildi/kapatıldı).
  const prNumber = session?.prNumber;
  const headSha = session?.headSha;
  useEffect(() => {
    if (!id || !prNumber || generating) return;
    let off = false;
    api
      .codePulls(id)
      .then((r) => !off && setPr(r.pulls.find((p) => p.number === prNumber) ?? r.pulls[0] ?? null))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [id, prNumber, headSha, generating]);

  // Soru/plan kartlarının düğmeleri (yalnızca son mesajda ve ajan çalışmıyorken).
  const actions = useMemo<MessageActions | undefined>(() => {
    if (!id) return undefined;
    return {
      answerable: !generating,
      onAnswer: (answer) => void useChats.getState().send({ content: answer, chatId: id, planMode: useCode.getState().plan[id] || undefined }),
      onApprove: () => {
        useCode.getState().setPlan(id, false);
        void useChats.getState().send({ content: t('code.plan.approveText'), chatId: id });
      },
      onRevise: () => setFocusSignal((n) => n + 1),
    };
  }, [id, generating, t]);

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

  const rewind = useCallback(
    async (messageId: string) => {
      if (!id) return;
      try {
        const r = await api.codeRewind(id, messageId);
        useCode.getState().upsertSession(r.session);
        await useChats.getState().openChat(id, true);
        useUi.getState().toast({ kind: 'success', text: t('code.rewind.done') });
      } catch (err) {
        reportError(err);
      }
    },
    [id, t],
  );

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
  const exportMd = () => {
    const path = selectPath(useChats.getState().detail[id]);
    const md = codeTranscriptMarkdown({ title, repo: session.repo, branch: session.workBranch, base: session.baseBranch, prUrl: session.prUrl }, path, { you: t('common.you'), ai: 'SixFinger' });
    void shareText(title, md);
  };
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
        <CodeThread chatId={id} onOpen={setTarget} actions={actions} />
      </View>

      {generating && (
        <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
          <CodeRunStatus run={run} startedAt={run?.startedAt ?? (streamingSince || startedAt)} runningTasks={runningTasks} />
        </View>
      )}
      {(session.additions + session.deletions > 0 || pr) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 6 }}>
          {session.additions + session.deletions > 0 && (
            <Press
              haptics="select"
              scale={0.95}
              accessibilityLabel={t('code.changes')}
              onPress={() => setSheet('changes')}
              style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}
            >
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: c.text }}>{t('code.chip.diff')}</RNText>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: c.success }}>+{session.additions}</RNText>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: c.text2 }}>−{session.deletions}</RNText>
              {!!session.headSha && session.headSha !== session.pushedSha && <View accessibilityLabel={t('code.pr.unpushed')} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warning }} />}
            </Press>
          )}
          {pr && (
            <Press
              haptics="select"
              scale={0.95}
              accessibilityLabel={t('code.pr.title')}
              onPress={() => void Linking.openURL(pr.url)}
              style={{ height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: pr.state === 'merged' ? c.accent : c.lineStrong, backgroundColor: c.surface }}
            >
              <GitPullRequest size={14} color={c.text2} />
              <RNText style={{ fontFamily: fonts.sans, fontSize: 13.5, color: c.text }}>
                #{pr.number} · {shortRepo}
              </RNText>
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: pr.state === 'closed' ? c.danger : c.text }}>{pr.draft && pr.state === 'open' ? t('code.pr.draft') : t(`code.pr.${pr.state}`)}</RNText>
            </Press>
          )}
        </View>
      )}
      <CodeComposer session={session} ready={hasDetail} focusSignal={focusSignal} />

      <CodeSheetHost chatId={id} target={target} onClose={() => setTarget(null)} onRewind={generating ? undefined : rewind} />
      <UsageSheet visible={sheet === 'usage'} onClose={() => setSheet(null)} tokens={session.contextTokens} limit={session.contextLimit} />
      <PullsSheet visible={sheet === 'pulls'} onClose={() => setSheet(null)} chatId={id} onChanged={() => { void loadSession(); void useChats.getState().openChat(id, true); }} />
      <ChangesSheet visible={sheet === 'changes'} onClose={() => setSheet(null)} chatId={id} additions={session.additions} deletions={session.deletions} files={session.filesChanged} onDiff={(path) => setDiff({ path })} />
      <FilesSheet visible={filesOpen} onClose={() => setFilesOpen(false)} chatId={id} />
      <DiffSheet visible={Boolean(diff)} onClose={() => setDiff(null)} chatId={id} path={diff?.path} />

      <SessionMenu
        session={menu ? session : null}
        onClose={() => setMenu(false)}
        onDelete={remove}
        onArchived={back}
        extra={(close) => (
          <>
            <MenuItem
              icon={<FolderOpen size={19} color={c.text} />}
              label={t('code.menu.files')}
              onPress={() => {
                close();
                setFilesOpen(true);
              }}
            />
            <MenuItem
              icon={<BookOpen size={19} color={c.text} />}
              label={t('code.menu.skills')}
              onPress={() => {
                close();
                router.push('/code/skills' as never);
              }}
            />
            <MenuItem
              icon={<Plug size={19} color={c.text} />}
              label={t('mcp.nav')}
              onPress={() => {
                close();
                router.push('/connectors' as never);
              }}
            />
            <MenuItem
              icon={<Download size={19} color={c.text} />}
              label={t('code.session.export')}
              onPress={() => {
                close();
                exportMd();
              }}
            />
          </>
        )}
      />
    </KeyboardAvoidingView>
  );
}
