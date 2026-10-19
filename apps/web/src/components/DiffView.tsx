import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { parseUnifiedDiff, type DiffFile } from '@sixfinger/shared';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { Delta } from './CodeSheets.tsx';

const STATUS_KEY = { added: 'code.file.added', modified: 'code.file.modified', deleted: 'code.file.deleted', renamed: 'code.file.renamed' } as const;

function FileDiff({ file, open: initial }: { file: DiffFile; open: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initial);
  return (
    <section className={clsx('diff-file', open && 'open')}>
      <button className="diff-file-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} className="diff-chevron" />
        <span className="diff-path" title={file.path}>
          <bdi>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</bdi>
        </span>
        <span className="change-status">{t(STATUS_KEY[file.status])}</span>
        <Delta add={file.additions} del={file.deletions} />
      </button>
      {open && (
        <div className="diff-body">
          {file.binary && <p className="muted diff-note">{t('code.diff.binary')}</p>}
          {file.hunks.map((h, i) => (
            <div key={i} className="diff-hunk">
              <div className="diff-hunk-head">{h.header}</div>
              {h.lines.map((l, j) => (
                <div key={j} className={clsx('diff-row', l.kind)}>
                  <span className="diff-no">{l.oldNo ?? ''}</span>
                  <span className="diff-no">{l.newNo ?? ''}</span>
                  <span className="diff-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                  <span className="diff-text">{l.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Birleşik farkı dosya dosya (açılır/kapanır) gösterir. */
export function DiffView({ diff, truncated }: { diff: string; truncated?: boolean }) {
  const t = useT();
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (!files.length) return <p className="muted">{t('code.diff.empty')}</p>;
  return (
    <div className="diff-view">
      {files.map((f) => (
        <FileDiff key={`${f.oldPath}>${f.path}`} file={f} open={files.length <= 3} />
      ))}
      {truncated && <p className="muted">{t('code.diff.truncated')}</p>}
    </div>
  );
}
