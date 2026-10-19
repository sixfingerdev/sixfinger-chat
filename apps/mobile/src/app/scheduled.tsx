import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarClock, ChevronRight, Plus } from 'lucide-react-native';
import { SCHEDULE_LIMITS, describeSchedule, type ScheduledTaskDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';
import { Button, Press } from '../components/Ui.tsx';
import { CodeHeader } from '../components/code/CodeUi.tsx';
import { ScheduleSheet } from '../components/schedule/ScheduleSheet.tsx';
import { TaskSheet, whenText } from '../components/schedule/TaskSheet.tsx';

/** Zamanlanmış görevler: kendin kur ya da asistana söyle; sonuçlar yeni sohbet olarak gelir. */
export default function Scheduled() {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const guest = useAuth((s) => s.user?.isGuest ?? false);
  const [tasks, setTasks] = useState<ScheduledTaskDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ task: ScheduledTaskDTO | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks((await api.schedules()).tasks);
      setFailed(false);
    } catch (err) {
      setFailed(true);
      reportError(err);
    }
  }, []);
  useEffect(() => {
    if (!guest) void load();
  }, [guest, load]);

  const upsert = (x: ScheduledTaskDTO) => setTasks((cur) => (cur ? (cur.some((y) => y.id === x.id) ? cur.map((y) => (y.id === x.id ? x : y)) : [x, ...cur]) : [x]));
  const current = tasks?.find((x) => x.id === openId) ?? null;
  const limitReached = (tasks?.length ?? 0) >= SCHEDULE_LIMITS.tasks;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const add = (
    <Press accessibilityLabel={t('sched.new')} haptics="tap" scale={0.88} disabled={guest || limitReached} onPress={() => setForm({ task: null })} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: guest || limitReached ? 0.4 : 1 }}>
      <Plus size={22} color={c.text} />
    </Press>
  );

  let body;
  if (guest) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16, paddingBottom: 60 }}>
        <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{t('sched.guest')}</RNText>
        <Button label={t('limits.upgrade')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'register' } })} />
      </View>
    );
  } else if (!tasks) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {failed ? <Button label={t('common.retry')} variant="secondary" onPress={() => void load()} /> : <ActivityIndicator color={c.text3} />}
      </View>
    );
  } else {
    body = (
      <FlatList
        data={tasks}
        keyExtractor={(x) => x.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={c.text3} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 28, gap: 8 }}
        ListHeaderComponent={<RNText style={[type.small, { color: c.text3, paddingBottom: 6 }]}>{t('sched.subtitle')}</RNText>}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 12, paddingTop: 40 }}>
            <CalendarClock size={30} color={c.text3} />
            <RNText style={[type.body, { color: c.text2 }]}>{t('sched.empty')}</RNText>
            <Button label={t('sched.new')} onPress={() => setForm({ task: null })} />
          </View>
        }
        renderItem={({ item: x }) => (
          <Press
            haptics="tap"
            scale={0.985}
            onPress={() => setOpenId(x.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, opacity: x.enabled ? 1 : 0.6 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <CalendarClock size={18} color={c.text2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <RNText numberOfLines={1} style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text }}>
                {x.title}
                {!x.enabled ? `  · ${t('sched.off')}` : x.lastStatus === 'error' ? `  · ${t('sched.status.error')}` : ''}
              </RNText>
              <RNText numberOfLines={2} style={[type.small, { color: c.text3 }]}>
                {describeSchedule(x.schedule, locale, x.timezone)}
                {x.nextRunAt ? ` · ${t('sched.next', { when: whenText(x.nextRunAt, locale, x.timezone) })}` : ''}
              </RNText>
            </View>
            <ChevronRight size={16} color={c.text3} />
          </Press>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('sched.title')} onBack={back} right={add} />
      {body}
      <TaskSheet
        task={current}
        onClose={() => setOpenId(null)}
        onChange={upsert}
        onEdit={(x) => {
          setOpenId(null);
          setForm({ task: x });
        }}
        onRemoved={(id) => {
          setTasks((cur) => (cur ?? []).filter((y) => y.id !== id));
          setOpenId(null);
        }}
      />
      <ScheduleSheet
        visible={Boolean(form)}
        task={form?.task}
        onClose={() => setForm(null)}
        onSaved={(x) => {
          upsert(x);
          setForm(null);
          useUi.getState().toast({ kind: 'success', text: t('sched.saved') });
        }}
      />
    </View>
  );
}
