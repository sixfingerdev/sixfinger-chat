import { useEffect, useState } from 'react';
import type { ImageRefDTO } from '@sixfinger/shared';
import { imageUrl } from '../lib/images.ts';
import { Modal } from './Modal.tsx';

/** Mesajdaki görsel: küçük resim; dokununca büyük açılır. Baytlar kimlik doğrulamalı uçtan çekilir. */
export function ChatImage({ image }: { image: ImageRefDTO }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    imageUrl(image.id).then((u) => live && setSrc(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [image.id]);
  if (!src) return <span className="msg-image loading" aria-hidden />;
  return (
    <>
      <button className="msg-image" onClick={() => setOpen(true)} aria-label={image.name}>
        <img src={src} alt={image.name} loading="lazy" />
      </button>
      {open && (
        <Modal hideHead wide onClose={() => setOpen(false)}>
          <img className="image-full" src={src} alt={image.name} onClick={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
