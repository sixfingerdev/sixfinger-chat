/** Düz dosya yollarından bir klasörün içeriğini çıkarır (dosya gezgini: istemci klasör ağacını kendisi kurar). */
export function listDir(paths: string[], dir: string): { dirs: string[]; files: string[] } {
  const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
  const dirs = new Set<string>();
  const files: string[] = [];
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash < 0) files.push(rest);
    else dirs.add(rest.slice(0, slash));
  }
  const sort = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return { dirs: [...dirs].sort(sort), files: files.sort(sort) };
}

/** "src/auth/login.ts" → ["", "src", "src/auth"] (üst klasör yolları). */
export function parentDirs(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1).reduce<string[]>((acc, p) => [...acc, acc.length ? `${acc[acc.length - 1]}/${p}` : p], ['']);
}
