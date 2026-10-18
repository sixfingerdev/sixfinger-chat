import { Text as RNText, View } from 'react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { Press } from './Ui.tsx';

/** İki–üç seçenekli yatay seçici. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: c.line }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Press
            key={o.id}
            haptics="select"
            scale={0.97}
            onPress={() => onChange(o.id)}
            style={{ flex: 1, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface3 : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.lineStrong }}
          >
            <RNText style={{ fontFamily: on ? fonts.sansSemibold : fonts.sansMedium, fontSize: 13.5, color: on ? c.text : c.text2 }}>{o.label}</RNText>
          </Press>
        );
      })}
    </View>
  );
}
