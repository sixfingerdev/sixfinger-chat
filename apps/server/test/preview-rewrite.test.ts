import { describe, expect, it } from 'vitest';
import { rewriteCss, rewriteHtml, rewriteJs, rewriteLocation } from '../src/lib/preview-rewrite.ts';
import { resolveStatic } from '../src/services/code-preview.ts';
import { mimeOf } from '../src/lib/mime.ts';

const P = '/api/code/preview/T';

describe('önizleme yeniden yazma', () => {
  it('HTML: köke göre src/href/action/poster yazılır; göreli, protokole göreli ve dış adresler kalır; tek tırnak desteklenir', () => {
    const out = rewriteHtml(`<script src='/a.js'></script><form action="/send"><video poster="/p.png"></video><a href="x.html">g</a><a href="//cdn/y">c</a><a href="https://e.com/z">e</a>`, P);
    expect(out).toContain(`src='${P}/a.js'`);
    expect(out).toContain(`action="${P}/send"`);
    expect(out).toContain(`poster="${P}/p.png"`);
    expect(out).toContain('href="x.html"');
    expect(out).toContain('href="//cdn/y"');
    expect(out).toContain('href="https://e.com/z"');
  });

  it('CSS: url() ve @import köke göre olanlar yazılır; data: ve göreli kalır', () => {
    const out = rewriteCss(`a{background:url( "/i.png")}b{background:url(i2.png)}c{background:url(data:image/png;base64,AAA)}@import "/b.css";`, P);
    expect(out).toContain(`url("${P}/i.png")`);
    expect(out).toContain('url(i2.png)');
    expect(out).toContain('url(data:image/png;base64,AAA)');
    expect(out).toContain(`@import "${P}/b.css"`);
  });

  it('JS: yalnızca modül belirteçleri yazılır', () => {
    const out = rewriteJs(`import a from "/a.js"; import "/side.js"; export * from '/c.js'; const x = import("/d.js"); const u = "/api/x"; const r = a / b;`, P);
    expect(out).toContain(`from "${P}/a.js"`);
    expect(out).toContain(`import "${P}/side.js"`);
    expect(out).toContain(`from '${P}/c.js'`);
    expect(out).toContain(`import("${P}/d.js")`);
    expect(out).toContain('"/api/x"');
  });

  it('Location: köke göre ve yerel dev-server adresleri önekle; dış adresler kalır', () => {
    expect(rewriteLocation('/x', P)).toBe(`${P}/x`);
    expect(rewriteLocation('http://localhost:5173/y?z=1', P)).toBe(`${P}/y?z=1`);
    expect(rewriteLocation('http://127.0.0.1:3000', P)).toBe(`${P}/`);
    expect(rewriteLocation('https://example.com/a', P)).toBe('https://example.com/a');
    expect(rewriteLocation('//cdn.example/a', P)).toBe('//cdn.example/a');
  });
});

describe('statik yol çözümü', () => {
  it('köke göre birleştirir; kök dışına çıkanları, ters eğik çizgiyi ve NUL\'u reddeder', () => {
    expect(resolveStatic('site', 'img/a.png')).toBe('site/img/a.png');
    expect(resolveStatic('', 'a.js')).toBe('a.js');
    expect(resolveStatic('site', '/a.js')).toBe('site/a.js');
    expect(resolveStatic('site', 'a/../b.js')).toBeNull();
    expect(resolveStatic('site', '../x')).toBeNull();
    expect(resolveStatic('site', 'a\\b')).toBeNull();
    expect(resolveStatic('site', 'a\0b')).toBeNull();
  });
  it('mime: bilinen uzantılar ve varsayılan', () => {
    expect(mimeOf('a.MJS')).toContain('javascript');
    expect(mimeOf('x.woff2')).toBe('font/woff2');
    expect(mimeOf('bilinmiyor.xyz')).toBe('application/octet-stream');
  });
});
