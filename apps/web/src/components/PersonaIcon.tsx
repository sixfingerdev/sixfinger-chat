import { ChartNoAxesCombined, GraduationCap, Languages, PenLine, Sparkles, Terminal, Zap, type LucideProps } from 'lucide-react';

const map = {
  sparkles: Sparkles,
  terminal: Terminal,
  'pen-line': PenLine,
  'graduation-cap': GraduationCap,
  languages: Languages,
  'chart-no-axes-combined': ChartNoAxesCombined,
  zap: Zap,
} as const;

export function PersonaIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = map[name as keyof typeof map] ?? Sparkles;
  return <Icon {...props} />;
}
