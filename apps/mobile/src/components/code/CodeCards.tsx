import { useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { CircleHelp, ListChecks } from 'lucide-react-native';
import { buildAnswerText, type AskQuestion, type MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { Field } from '../Field.tsx';
import { RichText } from '../RichText.tsx';
import { Button, Press } from '../Ui.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

/** Soru/plan kartlarının düğmeleri: yalnızca son mesajda ve ajan çalışmıyorken (`answerable`). */
export interface MessageActions {
  answerable: boolean;
  onAnswer: (text: string) => void;
  onApprove: () => void;
  onRevise: () => void;
}

const card = (c: ReturnType<typeof useTheme>['c']) => ({ marginVertical: 6, padding: 14, gap: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }) as const;

function CardHead({ icon, title, state }: { icon: React.ReactNode; title: string; state?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon}
      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>{title}</RNText>
      {!!state && <RNText style={{ marginLeft: 'auto', fontFamily: fonts.sans, fontSize: 12, color: c.text3 }}>{state}</RNText>}
    </View>
  );
}

/** Ajanın kullanıcıya sorduğu çoktan seçmeli sorular (ask_user). */
export function QuestionCard({ part, actions }: { part: ToolPart; actions?: MessageActions }) {
  const { c } = useTheme();
  const t = useT();
  const questions = (Array.isArray(part.meta?.questions) ? part.meta.questions : []) as AskQuestion[];
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map(() => false));
  if (!questions.length) return null;
  const live = Boolean(actions?.answerable);
  const answers = questions.map((q, i) => [...picked[i]!, ...(otherOn[i] && other[i]!.trim() ? [other[i]!.trim()] : [])]);
  const ready = answers.every((a) => a.length > 0);
  const toggle = (qi: number, label: string, multi: boolean) => {
    haptic.select();
    setPicked((p) => p.map((arr, i) => (i !== qi ? arr : multi ? (arr.includes(label) ? arr.filter((l) => l !== label) : [...arr, label]) : [label])));
    if (!multi) setOtherOn((s) => s.map((v, i) => (i === qi ? false : v)));
  };
  const option = (key: string, on: boolean, title: string, desc: string | undefined, onPress: () => void) => (
    <Press
      key={key}
      haptics={false}
      scale={0.985}
      disabled={!live}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : 'transparent' }}
    >
      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14.5, color: c.text }}>{title}</RNText>
      {!!desc && <RNText style={{ fontFamily: fonts.sans, fontSize: 12.5, color: c.text3 }}>{desc}</RNText>}
    </Press>
  );
  return (
    <View style={[card(c), !live && { opacity: 0.7 }]}>
      <CardHead icon={<CircleHelp size={16} color={c.text2} />} title={t('code.q.title')} state={live ? undefined : t('code.q.answered')} />
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 8 }}>
          <RNText style={[type.body, { color: c.text, fontSize: 15 }]}>
            {q.header ? `${q.header} · ` : ''}
            {q.question}
          </RNText>
          {q.multiSelect && live && <RNText style={[type.small, { color: c.text3 }]}>{t('code.q.multi')}</RNText>}
          {q.options.map((o) => option(o.label, picked[qi]!.includes(o.label), o.label, o.description, () => toggle(qi, o.label, Boolean(q.multiSelect))))}
          {live &&
            option(`other-${qi}`, otherOn[qi]!, t('code.q.other'), undefined, () => {
              haptic.select();
              setOtherOn((s) => s.map((v, i) => (i === qi ? !v : v)));
              if (!q.multiSelect) setPicked((p) => p.map((arr, i) => (i === qi ? [] : arr)));
            })}
          {live && otherOn[qi] && <Field value={other[qi]} onChangeText={(v) => setOther((s) => s.map((x, i) => (i === qi ? v : x)))} placeholder={t('code.q.otherPlaceholder')} maxLength={500} />}
        </View>
      ))}
      {live && <Button label={t('code.q.send')} disabled={!ready} onPress={() => actions!.onAnswer(buildAnswerText(questions, answers))} />}
    </View>
  );
}

/** Plan modunda ajanın sunduğu plan (exit_plan_mode); onaylanınca ajan uygular. */
export function PlanCard({ part, actions }: { part: ToolPart; actions?: MessageActions }) {
  const { c } = useTheme();
  const t = useT();
  const plan = (typeof part.meta?.plan === 'string' ? part.meta.plan : '') || part.output || '';
  const live = Boolean(actions?.answerable);
  return (
    <View style={card(c)}>
      <CardHead icon={<ListChecks size={16} color={c.text2} />} title={t('code.plan.title')} state={live ? undefined : t('code.plan.approved')} />
      <RichText text={plan} />
      {live && (
        <View style={{ gap: 6 }}>
          <Button label={t('code.plan.approve')} onPress={actions!.onApprove} />
          <Button variant="ghost" label={t('code.plan.revise')} onPress={actions!.onRevise} />
        </View>
      )}
    </View>
  );
}
