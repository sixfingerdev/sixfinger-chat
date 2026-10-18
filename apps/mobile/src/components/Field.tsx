import { useState } from 'react';
import { Text as RNText, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { Press } from './Ui.tsx';

/** Etiketli metin alanı; `secure` ile göz düğmeli parola alanı olur. */
export function Field({ label, hint, secure, error, ...props }: TextInputProps & { label?: string; hint?: string; secure?: boolean; error?: boolean }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 7 }}>
      {label && <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{label}</RNText>}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: props.multiline ? 96 : 50,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? c.danger : focus ? c.accent : c.lineStrong,
          backgroundColor: c.surface,
          paddingHorizontal: 14,
        }}
      >
        <TextInput
          {...props}
          secureTextEntry={secure && !show}
          onFocus={(e) => {
            setFocus(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            props.onBlur?.(e);
          }}
          placeholderTextColor={c.text3}
          cursorColor={c.accent}
          selectionColor={c.accentSoft}
          style={[{ flex: 1, fontFamily: fonts.sans, fontSize: 16, color: c.text, paddingVertical: props.multiline ? 12 : 0, textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]}
        />
        {secure && (
          <Press scale={0.85} onPress={() => setShow((s) => !s)} hitSlop={10} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
            {show ? <EyeOff size={18} color={c.text3} /> : <Eye size={18} color={c.text3} />}
          </Press>
        )}
      </View>
      {hint && <RNText style={{ fontFamily: fonts.sans, fontSize: 12.5, color: c.text3 }}>{hint}</RNText>}
    </View>
  );
}
