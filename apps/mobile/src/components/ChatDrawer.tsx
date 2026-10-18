import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { DrawerHost } from './Drawer.tsx';
import { Sidebar } from './Sidebar.tsx';

/** Kenar çekmecesi + ana içerik. Yalnızca ana sohbet ekranında sürüklenebilir. */
export function ChatDrawer({ children }: { children: ReactNode }) {
  const onChat = usePathname() === '/';
  return (
    <DrawerHost drawer={<Sidebar />} enabled={onChat}>
      {children}
    </DrawerHost>
  );
}
