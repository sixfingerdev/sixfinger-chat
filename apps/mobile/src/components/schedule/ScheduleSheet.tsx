import { useState } from 'react';
import { ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import { SCHEDULE_LIMITS, computeNextRun, type ChatMode, type ScheduleSpec, type ScheduledTaskDTO } from '@sixfinger/shared';
import { api, ApiError } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { fonts, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { Field } from '../Field.tsx';
import { Segmented } from '../Segmented.tsx';
import { Sheet } from '../Sheet.tsx';
import { Button, Press } from '../Ui.tsx';

type Kind = ScheduleSpec['kind'];
type Unit = 'min' | 'hour' | 'day';

const deviceTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
};

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-20 09:30" (yerel saat) ↔ Date. */
const toLocalText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseLocalText = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
};
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const DAYS = { tr: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };

/** Zamanlanmış görev oluştur / düzenle (alttan açılan sayfa). */
export function ScheduleSheet({ visible, task, onClose, onSaved }: { visible: boolean; task?: ScheduledTaskDTO | null; onClose: () => void; onSaved: (t: ScheduledTaskDTO) => void }) {
  const { height } = useWindowDimensions();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.82 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {visible && <Form key={task?.id ?? 'new'} task={task ?? undefined} onSaved={onSaved} />}
      </ScrollView>
    </Sheet>
  );
}

function Form({ task, onSaved }: { task?: ScheduledTaskDTO; onSaved: (t: ScheduledTaskDTO) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const sched = task?.schedule;
  const [title, setTitle] = useState(task?.title ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [mode, setMode] = useState<ChatMode>(task?.mode ?? 'balanced');
  const [kind, setKind] = useState<Kind>(sched?.kind ?? 'daily');
  const [time, setTime] = useState(sched && 'time' in sched ? sched.time : '09:00');
  const [days, setDays] = useState<number[]>(sched?.kind === 'weekly' ? sched.days : [1, 2, 3, 4, 5]);
  const initEvery = sched?.kind === 'interval' ? sched.minutes : 60;
  const [unit, setUnit] = useState<Unit>(initEvery % 1440 === 0 ? 'day' : initEvery % 60 === 0 ? 'hour' : 'min');
  const [every, setEvery] = useState(String(initEvery % 1440 === 0 ? initEvery / 1440 : initEvery % 60 === 0 ? initEvery / 60 : initEvery));
  const [at, setAt] = useState(toLocalText(sched?.kind === 'once' ? new Date(sched.at) : new Date(Date.now() + 3_600_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tz = task?.timezone ?? deviceTimezone();

  const minutes = (Number(every) || 0) * (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1);
  let built: ScheduleSpec | null = null;
  let problem = '';
  if (kind === 'daily' || kind === 'weekly') {
    if (!validTime(time)) problem = t('sched.timeFormat');
    else if (kind === 'daily') built = { kind, time };
    else if (days.length) built = { kind, days: [...days].sort(), time };
  } else if (kind === 'interval') {
    if (minutes < SCHEDULE_LIMITS.minIntervalMinutes) problem = t('sched.minInterval');
    else built = { kind, minutes };
  } else {
    const d = parseLocalText(at);
    if (!d) problem = t('sched.atFormat');
    else built = { kind, at: d.toISOString() };
  }
  if (built && !problem && !computeNextRun(built, tz, new Date())) problem = t('sched.pastTime');
  const valid = Boolean(title.trim() && prompt.trim() && built && !problem);

  const submit = async () => {
    if (!built) return;
    setBusy(true);
    setError('');
    try {
      const body = { title: title.trim(), prompt: prompt.trim(), mode, schedule: built, timezone: tz };
      const r = task ? await api.scheduleUpdate(task.id, body) : await api.scheduleCreate(body);
      haptic.success();
      onSaved(r.task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const label = (text: string) => <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{text}</RNText>;
  const quick = (text: string, d: Date) => (
    <Press key={text} haptics="select" scale={0.96} onPress={() => setAt(toLocalText(d))} style={{ paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.lineStrong, justifyContent: 'center' }}>
      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{text}</RNText>
    </Press>
  );
  const tomorrow9 = new Date();
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);

  return (
    <View style={{ gap: 14 }}>
      <RNText style={[type.heading as never, { color: c.text }]}>{task ? t('sched.edit') : t('sched.new')}</RNText>
      <Field label={t('sched.field.title')} value={title} onChangeText={setTitle} placeholder={t('sched.field.titlePh')} maxLength={SCHEDULE_LIMITS.titleMax} />
      <Field label={t('sched.field.prompt')} value={prompt} onChangeText={setPrompt} placeholder={t('sched.field.promptPh')} multiline maxLength={SCHEDULE_LIMITS.promptMax} textAlignVertical="top" />
      <View style={{ gap: 7 }}>
        {label(t('sched.field.mode'))}
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: 'fast', label: t('composer.mode.fast') },
            { id: 'balanced', label: t('composer.mode.balanced') },
            { id: 'deep', label: t('composer.mode.deep') },
          ]}
        />
      </View>
      <View style={{ gap: 7 }}>
        {label(t('sched.field.when'))}
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { id: 'daily', label: t('sched.kind.daily') },
            { id: 'weekly', label: t('sched.kind.weekly') },
            { id: 'interval', label: t('sched.kind.interval') },
            { id: 'once', label: t('sched.kind.once') },
          ]}
        />
      </View>
      {(kind === 'daily' || kind === 'weekly') && (
        <Field label={t('sched.field.time')} value={time} onChangeText={setTime} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} autoCorrect={false} error={!validTime(time)} />
      )}
      {kind === 'weekly' && (
        <View style={{ gap: 7 }}>
          {label(t('sched.field.days'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = days.includes(d);
              return (
                <Press
                  key={d}
                  haptics="select"
                  scale={0.94}
                  onPress={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                  style={{ minWidth: 46, height: 38, paddingHorizontal: 10, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accent : 'transparent', borderWidth: 1, borderColor: on ? c.accent : c.lineStrong }}
                >
                  <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13.5, color: on ? c.onAccent : c.text2 }}>{DAYS[locale][d - 1]}</RNText>
                </Press>
              );
            })}
          </View>
        </View>
      )}
      {kind === 'interval' && (
        <View style={{ gap: 7 }}>
          {label(t('sched.field.every'))}
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ width: 96 }}>
              <Field value={every} onChangeText={(v) => setEvery(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={4} />
            </View>
            <View style={{ flex: 1 }}>
              <Segmented
                value={unit}
                onChange={setUnit}
                options={[
                  { id: 'min', label: t('sched.unit.min') },
                  { id: 'hour', label: t('sched.unit.hour') },
                  { id: 'day', label: t('sched.unit.day') },
                ]}
              />
            </View>
          </View>
        </View>
      )}
      {kind === 'once' && (
        <View style={{ gap: 8 }}>
          <Field label={t('sched.field.at')} value={at} onChangeText={setAt} placeholder="2026-10-20 09:00" keyboardType="numbers-and-punctuation" maxLength={16} autoCorrect={false} />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {quick(t('sched.quick.hour'), new Date(Date.now() + 3_600_000))}
            {quick(t('sched.quick.tomorrow'), tomorrow9)}
          </View>
        </View>
      )}
      {!!problem && <RNText style={[type.small, { color: c.danger }]}>{problem}</RNText>}
      {!!error && <RNText style={[type.small, { color: c.danger }]}>{error}</RNText>}
      <RNText style={[type.small, { color: c.text3 }]}>{t('sched.tz', { tz })}</RNText>
      <Button label={t('common.save')} disabled={!valid} loading={busy} onPress={() => void submit()} />
    </View>
  );
}
