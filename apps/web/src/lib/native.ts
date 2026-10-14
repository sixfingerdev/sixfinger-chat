import { Capacitor } from '@capacitor/core';

/** Android uygulaması (Capacitor WebView) içinde mi çalışıyoruz? */
export const isNative: boolean = Capacitor.isNativePlatform();

export async function setStatusBar(dark: boolean): Promise<void> {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0b0b0c' : '#fafaf9' });
  } catch {
    /* eklenti yok */
  }
}

export async function hideSplash(): Promise<void> {
  if (!isNative) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* yoksay */
  }
}

/** Android geri tuşu: önce açık katmanları kapat, sonra geri git, en sonda uygulamadan çık. */
export async function onBackButton(handler: (info: { canGoBack: boolean }) => void): Promise<() => void> {
  if (!isNative) return () => {};
  const { App } = await import('@capacitor/app');
  const sub = await App.addListener('backButton', ({ canGoBack }) => handler({ canGoBack }));
  return () => void sub.remove();
}

export async function exitApp(): Promise<void> {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  await App.exitApp();
}
