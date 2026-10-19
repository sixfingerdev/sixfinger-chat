import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react-native';
import type { CodeChangesDTO, CodePullDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { formatTokens, timeUntil } from '../../lib/format.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useCode } from '../../store/code.ts';
import { Sheet } from '../Sheet.tsx';
import { Button, Press } from '../Ui.tsx';
import { SlashProgress } from './CodeUi.tsx';

const SheetTitle = ({ children }: { children: string }) => {
  const { c } = useTheme();
  return <RNText style={[type.label, { color: c.text3, paddingHorizontal: 22, paddingBottom: 10 }]}>{children}</RNText>;
};

/** Başlıktaki bağlam halkası: çevre çizgisi bağlam penceresinin doluluğunu gösterir (tek renk). */
export function ContextRing({ tokens, limit, size = 26 }: { tokens: number; limit: number; size?: number }) {
  const { c } = useTheme();
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const pct = limit > 0 ? Math.min(1, tokens / limit) : 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.lineStrong} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={pct >= 0.9 ? c.danger : c.accent}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${len * pct} ${len}`}
      />
    </Svg>
  );
}

/** "Kullanım" sayfası: bağlam penceresi doluluğu ve günlük Code kredisi. */
export function UsageSheet({ visible, onClose, tokens, limit }: { visible: boolean; onClose: () => void; tokens: number; limit: number }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const credits = useCode((s) => s.status?.credits);
  useEffect(() => {
    if (visible) void useCode.getState().loadStatus().catch(() => {});
  }, [visible]);
  const pct = limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>{t('code.usage.title')}</SheetTitle>
      <View style={{ paddingHorizontal: 22, paddingBottom: 14, gap: 22 }}>
        <View style={{ gap: 9 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>{t('code.usage.context')}</RNText>
            <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text2 }}>{pct}%</RNText>
          </View>
          <SlashProgress value={tokens} max={limit} />
          <RNText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: c.text2 }}>{t('code.usage.tokens', { used: formatTokens(tokens, locale), limit: formatTokens(limit, locale) })}</RNText>
          <RNText style={[type.small, { color: c.text3 }]}>{t('code.usage.hint')}</RNText>
        </View>
        {!!credits && credits.limit > 0 && (
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>{t('code.usage.credits')}</RNText>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text2 }}>{t('code.credits.value', { used: Math.round(credits.used * 10) / 10, limit: credits.limit })}</RNText>
            </View>
            <SlashProgress value={credits.used} max={credits.limit} />
            <RNText style={[type.small, { color: c.text3 }]}>{timeUntil(credits.resetsAt, locale)}</RNText>
          </View>
        )}
      </View>
    </Sheet>
  );
}

const PR_ICON = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed } as const;

function PullRow({ pr }: { pr: CodePullDTO }) {
  const { c } = useTheme();
  const t = useT();
  const Icon = pr.draft && pr.state === 'open' ? GitPullRequestDraft : PR_ICON[pr.state];
  const state = pr.draft && pr.state === 'open' ? t('code.pr.draft') : t(`code.pr.${pr.state}` as 'code.pr.open');
  return (
    <Press
      haptics="select"
      scale={0.985}
      onPress={() => void Linking.openURL(pr.url).catch(reportError)}
      accessibilityLabel={t('code.pr.github')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, borderRadius: radius.md }}
    >
      <Icon size={20} color={pr.state === 'open' ? c.text : c.text2} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <RNText numberOfLines={2} style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>
          {pr.title}
        </RNText>
        <RNText numberOfLines={1} style={[type.small, { color: c.text3 }]}>
          #{pr.number} · {state} · {t('code.pr.files', { n: pr.changedFiles })}
        </RNText>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.success }}>+{pr.additions}</RNText>
        <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>−{pr.deletions}</RNText>
      </View>
      <ExternalLink size={15} color={c.text3} />
    </Press>
  );
}

/** Oturumun çalışma branch'indeki pull request'ler; satıra dokununca GitHub'da açılır. */
export function PullsSheet({ visible, onClose, chatId, onChanged }: { visible: boolean; onClose: () => void; chatId: string; onChanged: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const [pulls, setPulls] = useState<CodePullDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  /** PR'ı ajan açar (başlık/açıklamayı model yazar): yalnızca otomatik adım çalışmadıysa gerekir. */
  const agentOpens = async () => {
    setBusy(true);
    try {
      await api.codeOpenPr(chatId);
      onChanged();
      setTick((n) => n + 1);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!visible) return;
    setPulls(null);
    setFailed(false);
    let off = false;
    api
      .codePulls(chatId)
      .then((r) => !off && setPulls(r.pulls))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [visible, chatId, tick]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>{t('code.pr.title')}</SheetTitle>
      <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}>
        {!pulls && !failed && <ActivityIndicator color={c.text3} style={{ paddingVertical: 28 }} />}
        {failed && <RNText style={[type.small, { color: c.text2, textAlign: 'center', paddingVertical: 28 }]}>{t('error.generic')}</RNText>}
        {pulls?.length === 0 && (
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 26, paddingHorizontal: 20 }}>
            <GitPullRequest size={26} color={c.text3} />
            <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: c.text }}>{t('code.pr.none')}</RNText>
            <RNText style={[type.small, { color: c.text3, textAlign: 'center' }]}>{t('code.pr.noneHint')}</RNText>
          </View>
        )}
        {pulls?.map((pr) => <PullRow key={pr.number} pr={pr} />)}
      </ScrollView>
      {pulls && !pulls.some((p) => p.state === 'open') && (
        <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8 }}>
          <Button label={t('code.pr.autoOpen')} loading={busy} icon={<GitPullRequest size={16} color={c.onAccent} />} onPress={() => void agentOpens()} />
        </View>
      )}
    </Sheet>
  );
}

/** Değişen dosyalar (+N −M). Ajan çalışırken liste yenilenmez; toplam son bilinen değerdir. */
export function ChangesSheet({ visible, onClose, chatId, additions, deletions, files, onDiff }: { visible: boolean; onClose: () => void; chatId: string; additions: number; deletions: number; files: number; onDiff: (path?: string) => void }) {
  const { c } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const [data, setData] = useState<CodeChangesDTO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setData(null);
    setFailed(false);
    let off = false;
    api
      .codeChanges(chatId)
      .then((r) => !off && setData(r))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [visible, chatId]);
  const add = data?.additions ?? additions;
  const del = data?.deletions ?? deletions;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 22, paddingBottom: 10 }}>
        <RNText style={[type.label, { color: c.text3 }]}>{t('code.changes')}</RNText>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.success }}>+{add}</RNText>
          <RNText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text2 }}>−{del}</RNText>
        </View>
      </View>
      <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 8, gap: 2 }}>
        {!data && !failed && <ActivityIndicator color={c.text3} style={{ paddingVertical: 28 }} />}
        {failed && <RNText style={[type.small, { color: c.text2, textAlign: 'center', paddingVertical: 28 }]}>{t('error.generic')}</RNText>}
        {data && !data.files.length && (
          <RNText style={[type.small, { color: c.text3, textAlign: 'center', paddingVertical: 26 }]}>{data.stale && files > 0 ? t('code.changes.files', { n: files }) : t('code.changes.none')}</RNText>
        )}
        {data?.files.map((f) => {
          const i = f.path.lastIndexOf('/');
          return (
            <Press key={f.path} haptics="select" scale={0.985} onPress={() => onDiff(f.path)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
                  {f.path.slice(i + 1)}
                </RNText>
                <RNText numberOfLines={1} style={[type.small, { fontSize: 12, color: c.text3 }]}>
                  {t(`code.file.${f.status}` as 'code.file.added')}
                  {i > 0 ? ` · ${f.path.slice(0, i)}` : ''}
                </RNText>
              </View>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.success }}>+{f.additions}</RNText>
              <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>−{f.deletions}</RNText>
            </Press>
          );
        })}
        {data?.stale && <RNText style={[type.small, { color: c.text3, paddingTop: 10 }]}>{t('code.changes.stale')}</RNText>}
      </ScrollView>
      {data && !data.stale && add + del > 0 && (
        <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8, gap: 6 }}>
          <Button label={t('code.diff.all')} onPress={() => onDiff()} />
        </View>
      )}
    </Sheet>
  );
}
