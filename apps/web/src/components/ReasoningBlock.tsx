import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatDuration } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';

export function ReasoningBlock({
  text,
  streaming,
  hasAnswer,
  ms,
}: {
  text: string;
  streaming: boolean;
  hasAnswer: boolean;
  ms: number | null;
}) {
  const t = useT();
  const thinking = streaming && !hasAnswer;
  const [open, setOpen] = useState(thinking);
  const touched = useRef(false);

  // Düşünme bitip yanıt başlayınca, kullanıcı elle açmadıysa kapat.
  useEffect(() => {
    if (touched.current) return;
    setOpen(thinking);
  }, [thinking]);

  if (!text) return null;
  const label = thinking ? t('msg.thinking') : ms ? t('msg.thoughtFor', { t: formatDuration(ms) }) : t('msg.thought');

  return (
    <div className={`reasoning${open ? ' open' : ''}${thinking ? ' live' : ''}`}>
      <button
        className="reasoning-head"
        aria-expanded={open}
        onClick={() => {
          touched.current = true;
          setOpen((o) => !o);
        }}
      >
        <ChevronRight size={14} className="reasoning-chevron" />
        <span className="reasoning-label">{label}</span>
        {thinking && <span className="reasoning-dots" aria-hidden />}
      </button>
      {/* Gövde hep bağlı kalır; açılıp kapanma yüksekliği CSS ile animasyonlanır. */}
      <div className="reasoning-collapse" aria-hidden={!open}>
        <div className="reasoning-clip">
          <div className="reasoning-body">{text}</div>
        </div>
      </div>
    </div>
  );
}
