/**
 * Model çıktısını remark-math'in anladığı biçime çevirir:
 *  \[ ... \]  ->  $$ ... $$
 *  \( ... \)  ->  $ ... $
 * Kod blokları ve satır içi kod olduğu gibi bırakılır.
 */
export function normalizeMath(src: string): string {
  const parts = src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // kod
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`);
    })
    .join('');
}
