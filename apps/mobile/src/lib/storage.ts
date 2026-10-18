import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Basit anahtar-değer deposu: açılışta bir kez belleğe yüklenir, okumalar senkron olur,
 * yazmalar arka planda diske gider. Hassas olmayan tercihler (dil, tema, sunucu adresi…) burada durur.
 */
const mem = new Map<string, string>();
const KEYS = ['sf.apiBase', 'sf.locale', 'sf.theme', 'sf.effort', 'sf.mode', 'sf.thinking', 'sf.user', 'sf.pinned.hint'] as const;

export const kv = {
  async init(): Promise<void> {
    try {
      const pairs = await AsyncStorage.multiGet([...KEYS]);
      for (const [k, v] of pairs) if (v !== null) mem.set(k, v);
    } catch {
      /* depolama okunamadı: varsayılanlarla devam */
    }
  },
  get(key: string): string | null {
    return mem.get(key) ?? null;
  },
  set(key: string, value: string): void {
    mem.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  },
  remove(key: string): void {
    mem.delete(key);
    AsyncStorage.removeItem(key).catch(() => {});
  },
};

/** Oturum belirteçleri Android Keystore'da şifreli saklanır; bellekte de bir kopya tutulur. */
const SESSION_KEY = 'sf.session';
let sessionMem: string | null = null;

export const secureSession = {
  async init(): Promise<void> {
    try {
      sessionMem = await SecureStore.getItemAsync(SESSION_KEY);
    } catch {
      sessionMem = null;
    }
  },
  get(): string | null {
    return sessionMem;
  },
  set(value: string): void {
    sessionMem = value;
    SecureStore.setItemAsync(SESSION_KEY, value).catch(() => {});
  },
  clear(): void {
    sessionMem = null;
    SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
  },
};
