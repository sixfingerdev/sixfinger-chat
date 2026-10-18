import { useEffect, useState } from 'react';
import { AppState, Text as RNText, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useFonts } from 'expo-font';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { initLocale, useT } from '../lib/i18n/index.ts';
import { kv, secureSession } from '../lib/storage.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { hydrateUi } from '../store/ui.ts';
import { ChatDrawer } from '../components/ChatDrawer.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { ConfirmHost } from '../components/ConfirmHost.tsx';
import { Toasts } from '../components/Toasts.tsx';
import { Button } from '../components/Ui.tsx';

void SplashScreen.preventAutoHideAsync();

function Shell() {
  const { c, name } = useTheme();
  const t = useT();
  const ready = useAuth((s) => s.ready);
  const user = useAuth((s) => s.user);
  const bootError = useAuth((s) => s.bootError);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg);
  }, [c.bg]);

  // Üretim sürerken uygulama kapatılmış olabilir: açılışta o sohbete dön (sunucuda sürüyorsa canlı, bittiyse sonuç).
  useEffect(() => {
    if (!ready || !user) return;
    const pending = kv.get('sf.pending');
    if (!pending) return;
    kv.remove('sf.pending');
    void useChats.getState().openChat(pending);
  }, [ready, user]);

  // Uygulama bir süre arka plandaysa üretim sunucuda sürmüş olabilir: ön plana dönünce eşitle / canlı izlemeye bağlan.
  useEffect(() => {
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') leftAt = Date.now();
      else if (state === 'active' && leftAt && Date.now() - leftAt > 4_000) {
        leftAt = 0;
        useChats.getState().refreshActive();
      }
    });
    return () => sub.remove();
  }, []);

  if (ready && !user) {
    // Sunucuya ulaşılamadı ve önbellekte kullanıcı yok.
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
        <LogoMark size={40} />
        <RNText style={[type.heading as never, { color: c.text, textAlign: 'center' }]}>{bootError ?? t('common.networkError')}</RNText>
        <Button label={t('common.retry')} onPress={() => void useAuth.getState().boot()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <ChatDrawer>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade_from_bottom', animationDuration: 260 }}>
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="auth" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </ChatDrawer>
      <ConfirmHost />
      <Toasts />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular, GeistMono_500Medium });
  const [storageReady, setStorageReady] = useState(false);
  const ready = useAuth((s) => s.ready);

  useEffect(() => {
    (async () => {
      await Promise.all([kv.init(), secureSession.init()]);
      hydrateUi();
      initLocale();
      setStorageReady(true);
      await useAuth.getState().boot();
    })();
  }, []);

  useEffect(() => {
    if (fontsLoaded && storageReady && ready) void SplashScreen.hideAsync();
  }, [fontsLoaded, storageReady, ready]);

  if (!fontsLoaded || !storageReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
