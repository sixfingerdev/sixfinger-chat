import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text as RNText, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Pencil, Play, Trash2 } from 'lucide-react-native';
import { describeSchedule, type ScheduledRunDTO, type ScheduledTaskDTO } from '@sixfinger/shared';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useChats } from '../../store/chats.ts';
import { useUi } from '../../store/ui.ts';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { Sheet } from '../Sheet.tsx';
import { Press } from '../Ui.tsx';

export const whenText = (iso: string, locale: 'tr' | 'en', tz: string) =>
  new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

/** Görev ayrıntısı: aç/kapat, şimdi çalıştır, düzenle, sil ve son çalışmaların sohbetleri. */
export function TaskSheet({ task, onClose, onChange, onEdit, onRemoved }: { task: ScheduledTaskDTO | null; onClose: () => void; onChange: (t: ScheduledTaskDTO) => void; onEdit: (t: ScheduledTaskDTO) => void; onRemoved: (id: string) => void }) {
  const { height } = useWindowDimensions();
  // Kapanış animasyonu sürerken içerik kaybolmasın diye son görev tutulur.
  const [last, setLast] = useState<ScheduledTaskDTO | null>(null);
  if (task && task !== last) setLast(task);
  const x = task ?? last;
  return (
    <Sheet visible={Boolean(task)} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.8 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        {x && <Body task={x} onClose={onClose} onChange={onChange} onEdit={onEdit} onRemoved={onRemoved} />}
      </ScrollView>
    </Sheet>
  );
}

function Body({ task, onClose, onChange, onEdit, onRemoved }: { task: ScheduledTaskDTO; onClose: () => void; onChange: (t: ScheduledTaskDTO) => void; onEdit: (t: ScheduledTaskDTO) => void; onRemoved: (id: string) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [runs, setRuns] = useState<ScheduledRunDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.scheduleRuns(task.id).then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, [task.id, task.lastRunAt]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      onChange((await api.scheduleUpdate(task.id, { enabled })).task);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      await api.scheduleRun(task.id);
      haptic.success();
      useUi.getState().toast({ kind: 'info', text: t('sched.run.started') });
      // Sonuç birkaç saniye içinde gelir: sohbet listesini ve görevi tazele.
      setTimeout(() => {
        void useChats.getState().loadChats();
        api.schedules().then((r) => {
          const fresh = r.tasks.find((y) => y.id === task.id);
          if (fresh) onChange(fresh);
        }).catch(() => {});
      }, 6_000);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    useUi.getState().askConfirm({
      title: t('sched.deleteConfirm'),
      message: task.title,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.scheduleDelete(task.id);
          useUi.getState().toast({ kind: 'success', text: t('sched.deleted') });
          onRemoved(task.id);
        } catch (err) {
          reportError(err);
        }
      },
    });

  const action = (icon: React.ReactNode, label: string, onPress: () => void, danger = false) => (
    <Press haptics="tap" scale={0.96} disabled={busy} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: danger ? c.danger : c.lineStrong }}>
      {icon}
      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: danger ? c.danger : c.text }}>{label}</RNText>
    </Press>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 3 }}>
        <RNText style={[type.heading as never, { color: c.text }]}>{task.title}</RNText>
        <RNText style={[type.small, { color: c.text3 }]}>{describeSchedule(task.schedule, locale, task.timezone)}</RNText>
      </View>
      <RNText style={[type.small, { color: c.text2, padding: 12, borderRadius: radius.md, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line }]}>{task.prompt}</RNText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <RNText style={[type.body, { color: c.text }]}>{task.enabled ? (task.nextRunAt ? t('sched.next', { when: whenText(task.nextRunAt, locale, task.timezone) }) : t('sched.status.skipped')) : t('sched.off')}</RNText>
          {task.source === 'agent' && <RNText style={[type.small, { color: c.text3 }]}>{t('sched.byAgent')}</RNText>}
        </View>
        <Switch value={task.enabled} disabled={busy} onValueChange={(v) => void toggle(v)} trackColor={{ true: c.accent, false: c.surface3 }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {action(<Play size={15} color={c.text} />, t('sched.run'), () => void run())}
        {action(<Pencil size={15} color={c.text} />, t('sched.editShort'), () => onEdit(task))}
        {action(<Trash2 size={15} color={c.danger} />, t('common.delete'), remove, true)}
      </View>
      {!!task.lastError && <RNText style={[type.small, { color: c.danger }]}>{task.lastError}</RNText>}
      <RNText style={[type.label, { color: c.text3, paddingTop: 4 }]}>{t('sched.history')}</RNText>
      {runs === null ? null : runs.length === 0 ? (
        <RNText style={[type.small, { color: c.text3 }]}>{t('sched.never')}</RNText>
      ) : (
        runs.map((r) => (
          <Press
            key={r.chatId}
            haptics="tap"
            scale={0.985}
            onPress={() => {
              onClose();
              void useChats.getState().openChat(r.chatId);
              if (router.canGoBack()) router.back();
              else router.replace('/');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}
          >
            <View style={{ flex: 1 }}>
              <RNText numberOfLines={1} style={[type.body, { color: c.text }]}>{r.title}</RNText>
              <RNText style={[type.small, { color: c.text3 }]}>{ago(r.at, locale)}</RNText>
            </View>
            <ChevronRight size={16} color={c.text3} />
          </Press>
        ))
      )}
    </View>
  );
}
