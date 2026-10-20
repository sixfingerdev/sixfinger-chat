import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../theme/index.tsx';
import { bootApp } from '../lib/boot.ts';
import { AssistantPanel } from './AssistantPanel.tsx';

/** Asistan penceresinin kökü: ana uygulamayla aynı oturum/sohbet deposunu kullanır; şeffaf zeminde yalnızca paneli çizer. */
export function AssistantRoot() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular, GeistMono_500Medium });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void bootApp().finally(() => setReady(true));
  }, []);

  if (!fontsLoaded || !ready) return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <AssistantPanel />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
