import type { ReactNode } from 'react';
import { Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Cloud, Globe, Menu, Shield, WifiOff } from 'lucide-react-native';
import type { CodeNetwork } from '@sixfinger/shared';
import { fonts, radius, slash, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useT } from '../../lib/i18n/index.ts';
import { Press } from '../Ui.tsx';

/** GitHub işareti (marka simgesi; lucide v1 marka simgelerini kaldırdı). */
export function GithubMark({ size = 20, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color ?? c.text}>
      <Path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </Svg>
  );
}

export const NETWORK_ICON = { none: WifiOff, trusted: Shield, full: Globe, custom: Cloud } as const satisfies Record<CodeNetwork, unknown>;

/** Code ekranlarının üst çubuğu: geri ya da menü, başlık (isteğe bağlı alt başlık), sağ eylem. */
export function CodeHeader({
  title,
  subtitle,
  onBack,
  onMenu,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onMenu?: () => void;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 2 }}>
        {onBack ? (
          <Press accessibilityLabel={t('common.back')} haptics="tap" scale={0.88} onPress={onBack} style={btn}>
            <ChevronLeft size={24} color={c.text} />
          </Press>
        ) : onMenu ? (
          <Press accessibilityLabel={t('sidebar.toggle')} haptics="tap" scale={0.88} onPress={onMenu} style={btn}>
            <Menu size={22} color={c.text} />
          </Press>
        ) : null}
        <View style={{ flex: 1, paddingHorizontal: 6 }}>
          <RNText numberOfLines={1} style={[type.heading as never, { color: c.text, fontSize: 17 }]}>
            {title}
          </RNText>
          {!!subtitle && (
            <RNText numberOfLines={1} style={[type.small, { color: c.text3, marginTop: -1 }]}>
              {subtitle}
            </RNText>
          )}
        </View>
        {right}
      </View>
    </View>
  );
}
const btn = { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 }}>
      <RNText style={[type.label, { color: c.text3 }]}>{children}</RNText>
      {right}
    </View>
  );
}

/** Yuvarlak çip: repo/ortam/model seçicileri ve liste şeridi için. */
export function Chip({
  icon,
  label,
  onPress,
  active,
  dashed,
  style,
  maxWidth,
}: {
  icon?: ReactNode;
  label: string;
  onPress?: () => void;
  active?: boolean;
  dashed?: boolean;
  style?: StyleProp<ViewStyle>;
  maxWidth?: number;
}) {
  const { c } = useTheme();
  return (
    <Press
      haptics="select"
      scale={0.96}
      onPress={onPress}
      style={[
        {
          height: 38,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          borderRadius: 19,
          backgroundColor: active ? c.accentSoft : c.surface,
          borderWidth: 1,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: active ? c.accent : c.lineStrong,
          maxWidth,
        },
        style,
      ]}
    >
      {icon}
      <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: active ? c.text : c.text2, flexShrink: 1 }}>
        {label}
      </RNText>
    </Press>
  );
}

/** Eğik uçlu ilerleme çubuğu (markanın eğik çizgi motifi). `warn`: dolmaya yakın. */
export function SlashProgress({ value, max, danger }: { value: number; max: number; danger?: boolean }) {
  const { c } = useTheme();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface3, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: danger || pct >= 100 ? c.danger : c.accent, transform: [{ skewX: slash.soft }] }} />
    </View>
  );
}

export function StatusDot({ status }: { status: 'idle' | 'running' | 'error' }) {
  const { c } = useTheme();
  const color = status === 'running' ? c.success : status === 'error' ? c.danger : c.text3;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

export const cardStyle = (c: { surface: string; line: string }): ViewStyle => ({
  backgroundColor: c.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: c.line,
});
