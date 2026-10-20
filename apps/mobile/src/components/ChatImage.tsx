import { useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import type { ImageRefDTO } from '@sixfinger/shared';
import { imageSource } from '../lib/images.ts';
import { useTheme } from '../theme/index.tsx';

/** Mesajdaki görsel: küçük resim; dokununca tam ekran açılır. Baytlar kimlik doğrulamalı uçtan çekilir. */
export function ChatImage({ image }: { image: ImageRefDTO }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const source = imageSource(image.id);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={image.name} style={{ width: 132, height: 132, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.line, backgroundColor: c.surface2 }}>
        <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
          <Image source={source} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          <View style={{ position: 'absolute', top: insets.top + 10, right: 14, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}>
            <X size={20} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
