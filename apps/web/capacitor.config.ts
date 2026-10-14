import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'live.sixfinger.chat',
  appName: 'SixFinger',
  webDir: 'dist',
  backgroundColor: '#0b0b0c',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0b0b0c' },
    Keyboard: { resize: 'body', resizeOnFullScreen: true },
    StatusBar: { style: 'DARK', backgroundColor: '#0b0b0c' },
  },
};

export default config;
