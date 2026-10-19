import { router } from 'expo-router';

/** Code bölümünden (ve alt ekranlarından) sohbet ekranına döner. */
export function leaveCode(): void {
  try {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/');
  } catch {
    router.replace('/');
  }
}

/** Code ana ekranını açar (zaten Code içindeyse bir şey yapmaz). */
export function enterCode(pathname: string): void {
  if (!pathname.startsWith('/code')) router.push('/code');
}
