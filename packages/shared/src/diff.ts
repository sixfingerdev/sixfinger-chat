/** `git diff` çıktısının (birleşik biçim) istemcilerde gösterilebilir yapısı. */
export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
  /** Eski/yeni dosyadaki satır numarası (yoksa null). */
  oldNo: number | null;
  newNo: number | null;
}
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Birleşik farkı dosyalara/parçalara ayırır. Beklenmeyen satırları yok sayar (bozuk girdide çökmez). */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      file = { path: m?.[2] ?? '', oldPath: null, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = line.slice(12);
      } else if (line.startsWith('rename to ')) file.path = line.slice(10);
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('+++ b/')) file.path = line.slice(6);
      else if (line.startsWith('--- a/') && file.status !== 'renamed') file.oldPath = null;
    }
    const h = HUNK.exec(line);
    if (h) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      continue;
    }
    if (!hunk) continue;
    const c = line[0];
    if (c === '+') {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ });
      file.additions++;
    } else if (c === '-') {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null });
      file.deletions++;
    } else if (c === ' ') {
      hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
    // '\ No newline at end of file' ve boş satırlar atlanır
  }
  return files;
}
