import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { DrawerHost } from './Drawer.tsx';
import { Sidebar } from './Sidebar.tsx';

/** Kenar çekmecesi + ana içerik. Yalnızca ana sohbet ve Code ana ekranında sürüklenebilir. */
export function ChatDrawer({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <DrawerHost drawer={<Sidebar />} enabled={path === '/' || path === '/code'}>
      {children}
    </DrawerHost>
  );
}
