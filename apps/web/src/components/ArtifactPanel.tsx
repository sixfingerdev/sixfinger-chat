import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Maximize2, X } from 'lucide-react';
import { useThrottled } from '../lib/useThrottled.ts';
import { collectArtifacts, type ArtifactKind } from '@sixfinger/shared';
import { copyText } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { selectPath, useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Md as Markdown } from './MarkdownLazy.tsx';
import { SandboxFrame } from './SandboxFrame.tsx';

const EXT: Record<ArtifactKind, [string, string]> = {
  html: ['html', 'text/html'],
  svg: ['svg', 'image/svg+xml'],
  markdown: ['md', 'text/markdown'],
  mermaid: ['mmd', 'text/plain'],
};
const LANG: Record<ArtifactKind, string> = { html: 'html', svg: 'xml', markdown: 'markdown', mermaid: 'text' };

/** İçerikte geçen en uzun ` dizisinden daha uzun bir çit seçer (kodu bozmadan göstermek için). */
function fenced(code: string, lang: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${code}\n${fence}`;
}

export function ArtifactPanel() {
  const t = useT();
  const id = useUi((s) => s.artifactId);
  const close = useUi((s) => s.closeArtifact);
  const liveDetail = useChats((s) => (s.activeId ? s.detail[s.activeId] : undefined));
  const generating = useChats((s) => Boolean(s.activeId && s.generating[s.activeId]));
  // Üretim sürerken içerik her karede değişir: panel en çok 400 ms'de bir güncellenir (donmayı önler).
  const detail = useThrottled(liveDetail, 400, generating);
  // Kapalıyken hiçbir şey ayrıştırılmaz.
  const entries = useMemo(
    () => (id ? collectArtifacts(selectPath(detail).map((m) => (m.role === 'assistant' ? m.content : ''))) : []),
    [id, detail],
  );
  const entry = entries.find((e) => e.id === id);

  const [version, setVersion] = useState<number | null>(null); // null = en yeni
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const idx = entry ? Math.min(version ?? entry.versions.length - 1, entry.versions.length - 1) : 0;
  const current = entry?.versions[idx];
  const writing = Boolean(current && !current.closed);

  useEffect(() => {
    setVersion(null);
    setError(null);
  }, [id]);
  // Yazılırken kodu göster; bitince önizlemeye geç.
  useEffect(() => {
    setTab(writing ? 'code' : 'preview');
    if (!writing) setError(null);
  }, [writing, id]);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, close]);

  if (!id || !entry || !current) return null;
  const [ext, mime] = EXT[entry.kind];

  const download = () => {
    const url = URL.createObjectURL(new Blob([current.content], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="artifact-panel" aria-label={entry.title}>
      <header className="artifact-head">
        <div className="artifact-titles">
          <strong>{entry.title}</strong>
          <span>{t(`artifact.kind.${entry.kind}` as 'artifact.kind.html')}</span>
        </div>
        {entry.versions.length > 1 && (
          <select className="artifact-version" value={idx} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Version">
            {entry.versions.map((_, i) => (
              <option key={i} value={i}>
                {t('artifact.version', { n: i + 1 })}
              </option>
            ))}
          </select>
        )}
        <div className="artifact-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'preview'} disabled={writing} onClick={() => setTab('preview')}>
            {t('artifact.preview')}
          </button>
          <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
            {t('artifact.code')}
          </button>
        </div>
        <div className="artifact-actions">
          <button
            className="icon-btn sm"
            aria-label={t('common.copy')}
            title={t('common.copy')}
            onClick={async () => {
              if (await copyText(current.content)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button className="icon-btn sm" aria-label={t('artifact.download')} title={t('artifact.download')} onClick={download}>
            <Download size={16} />
          </button>
          {entry.kind !== 'markdown' && tab === 'preview' && (
            <button className="icon-btn sm" aria-label={t('artifact.fullscreen')} title={t('artifact.fullscreen')} onClick={() => void frame.current?.requestFullscreen?.()}>
              <Maximize2 size={16} />
            </button>
          )}
          <button className="icon-btn sm" aria-label={t('common.close')} onClick={close}>
            <X size={18} />
          </button>
        </div>
      </header>
      {error && tab === 'preview' && <div className="artifact-error">{t('artifact.error')}: {error}</div>}
      <div className="artifact-body">
        {tab === 'code' ? (
          <div className="artifact-code">
            {!current.content ? (
              <p className="artifact-empty">{t('artifact.empty')}</p>
            ) : writing ? (
              // Yazılırken yalnızca son satırlar, renklendirmesiz: maliyet kodun boyuna bağlı değil.
              <>
                <p className="artifact-lines">{t('artifact.lines', { n: current.content.split('\n').length })}</p>
                <pre className="artifact-tail">{current.content.split('\n').slice(-60).join('\n')}</pre>
              </>
            ) : (
              <Markdown text={fenced(current.content, LANG[entry.kind])} />
            )}
          </div>
        ) : entry.kind === 'markdown' ? (
          <div className="artifact-doc">
            <Markdown text={current.content} />
          </div>
        ) : (
          <SandboxFrame
            key={`${id}-${idx}`}
            ref={frame}
            kind={entry.kind}
            mode="artifact"
            content={current.content}
            title={entry.title}
            className="artifact-frame"
            onError={setError}
            onPrompt={(text) => useUi.getState().setPrefill(text)}
          />
        )}
      </div>
    </aside>
  );
}
