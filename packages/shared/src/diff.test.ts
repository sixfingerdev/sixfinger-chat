import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff.ts';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ function x() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 return a;
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+merhaba
+dünya
diff --git a/old name.md b/new name.md
similarity index 90%
rename from old name.md
rename to new name.md
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/gone.js b/gone.js
deleted file mode 100644
--- a/gone.js
+++ /dev/null
@@ -1 +0,0 @@
-bye
\\ No newline at end of file
`;

describe('parseUnifiedDiff', () => {
  const f = parseUnifiedDiff(SAMPLE);
  it('dosyaları, durumları ve sayıları çıkarır', () => {
    expect(f.map((x) => [x.path, x.status, x.additions, x.deletions])).toEqual([
      ['src/a.ts', 'modified', 2, 1],
      ['new.txt', 'added', 2, 0],
      ['new name.md', 'renamed', 0, 0],
      ['img.png', 'modified', 0, 0],
      ['gone.js', 'deleted', 0, 1],
    ]);
    expect(f[2]!.oldPath).toBe('old name.md');
    expect(f[3]!.binary).toBe(true);
  });
  it('satır numaralarını doğru taşır', () => {
    expect(f[0]!.hunks[0]!.lines).toEqual([
      { kind: 'ctx', text: 'const a = 1;', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'const b = 2;', oldNo: 2, newNo: null },
      { kind: 'add', text: 'const b = 3;', oldNo: null, newNo: 2 },
      { kind: 'add', text: 'const c = 4;', oldNo: null, newNo: 3 },
      { kind: 'ctx', text: 'return a;', oldNo: 3, newNo: 4 },
    ]);
  });
  it('boş ya da bozuk girdide çökmez', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('rastgele\nmetin\n@@ bozuk')).toEqual([]);
  });
});
