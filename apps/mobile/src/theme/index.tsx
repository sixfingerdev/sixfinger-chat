import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { dark, light, type Palette, type ThemeName } from './tokens.ts';
import { useUi } from '../store/ui.ts';

export * from './tokens.ts';

interface ThemeValue {
  name: ThemeName;
  c: Palette;
}

const Ctx = createContext<ThemeValue>({ name: 'dark', c: dark });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pref = useUi((s) => s.theme);
  const system = useColorScheme();
  const name: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref;
  const value = useMemo<ThemeValue>(() => ({ name, c: name === 'dark' ? dark : light }), [name]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = (): ThemeValue => useContext(Ctx);

/** Tema renklerine bağlı stiller: `const s = useStyles((c) => ({ box: { backgroundColor: c.surface } }))`. */
type Style = ViewStyle | TextStyle | ImageStyle;

export function useStyles<T extends Record<string, Style>>(factory: (c: Palette, name: ThemeName) => T): T {
  const { c, name } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(c, name) as never) as unknown as T, [c, name]);
}
