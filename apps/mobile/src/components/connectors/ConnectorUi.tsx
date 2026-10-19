import { Image, Switch, Text as RNText, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { mcpLogo } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useT } from '../../lib/i18n/index.ts';
import type { ServerStatus } from '../../lib/mcp.ts';

/** Bağlayıcı simgesi: markanın resmî logosu (varsa), yoksa adın baş harfi. */
export function Avatar({ label, preset, size = 40 }: { label: string; preset?: string | null; size?: number }) {
  const { c, name } = useTheme();
  const logo = mcpLogo(preset);
  const px = Math.round(size * 0.56);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {logo && 'svg' in logo ? (
        <SvgXml xml={name === 'dark' && logo.dark ? logo.dark : logo.svg} width={px} height={px} />
      ) : logo ? (
        <Image source={{ uri: logo.png }} style={{ width: px, height: px }} resizeMode="contain" />
      ) : (
        <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: size * 0.42, color: c.text2 }}>{(label.trim()[0] ?? '?').toUpperCase()}</RNText>
      )}
    </View>
  );
}

/** Küçük yuvarlak rozet ("Etkileşimli", "Salt okunur"…). `outline`: yalnızca çerçeve. */
export function Pill({ children, outline }: { children: string; outline?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: outline ? 'transparent' : c.surface3, borderWidth: outline ? 1 : 0, borderColor: c.lineStrong }}>
      <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 11, color: c.text2 }}>{children}</RNText>
    </View>
  );
}

/** Durum çipi: nokta + metin (tamam / yetki gerekiyor / hata / kapalı). */
export function StatusChip({ status }: { status: ServerStatus }) {
  const { c } = useTheme();
  const t = useT();
  const text = status.kind === 'ok' ? t('mcp.status.ok', { n: status.tools }) : status.kind === 'needsAuth' ? t('mcp.status.needsAuth') : status.kind === 'error' ? t('mcp.status.error') : t('mcp.status.off');
  const color = status.kind === 'error' ? c.danger : status.kind === 'ok' ? c.text2 : c.text3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: status.kind === 'ok' ? c.text2 : 'transparent', borderWidth: status.kind === 'ok' ? 0 : 1.5, borderColor: color }} />
      <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 12.5, color }}>
        {text}
      </RNText>
    </View>
  );
}

/** Başlık + isteğe bağlı açıklama solda, anahtar sağda. */
export function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <RNText style={[type.body, { color: c.text, fontSize: 15, lineHeight: 20 }]}>{label}</RNText>
        {!!hint && <RNText style={[type.small, { color: c.text3 }]}>{hint}</RNText>}
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: c.accent, false: c.surface3 }} />
    </View>
  );
}

/** Gruplanmış satırlar için çerçeveli kutu. */
export function Group({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <View style={{ paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>{children}</View>;
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line }} />;
}
