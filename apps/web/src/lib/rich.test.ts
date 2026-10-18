import { describe, expect, it } from 'vitest';
import { SANDBOX_CSP, buildSandboxDoc, collectArtifacts, parseRich, parseSandboxMessage } from '@sixfinger/shared';

describe('parseRich', () => {
  it('metin, artifact ve metni sırayla ayırır', () => {
    const s = parseRich('Tamam.\n<artifact id="yilan" type="html" title="Yılan Oyunu">\n<h1>Merhaba</h1>\n</artifact>\nBitti.');
    expect(s.map((x) => x.type)).toEqual(['markdown', 'artifact', 'markdown']);
    expect(s[1]).toMatchObject({ id: 'yilan', kind: 'html', title: 'Yılan Oyunu', content: '<h1>Merhaba</h1>', closed: true });
  });

  it('akış sırasında yarım kalan artifact closed:false döner', () => {
    const s = parseRich('Başla\n<artifact title="Oyun">\n<script>let a=1;');
    expect(s[1]).toMatchObject({ type: 'artifact', closed: false, id: 'oyun' });
    expect((s[1] as { content: string }).content).toContain('let a=1;');
  });

  it('yarım açılış etiketini metin olarak göstermez (titremeyi önler)', () => {
    expect(parseRich('Merhaba <artif')).toEqual([{ type: 'markdown', text: 'Merhaba ' }]);
    expect(parseRich('Merhaba <artifact id="x"')).toEqual([{ type: 'markdown', text: 'Merhaba ' }]);
    expect(parseRich('a < b ve c')).toEqual([{ type: 'markdown', text: 'a < b ve c' }]);
  });

  it('açıklama içeren kod bloğundaki etiketi çalıştırmaz', () => {
    const s = parseRich('Biçim şöyle:\n```\nÖrnek kullanım:\n<artifact id="x">test</artifact>\n```\nbu kadar');
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe('markdown');
  });

  it('etiketi doğrudan saran çiti soyar (küçük modellerin alışkanlığı), akış sırasında da', () => {
    const done = parseRich('Bak:\n```html\n<widget title="W"><b>x</b></widget>\n```\nSonra');
    expect(done.map((x) => x.type)).toEqual(['markdown', 'widget', 'markdown']);
    expect(done[1]).toMatchObject({ content: '<b>x</b>', closed: true });
    const live = parseRich('Bak:\n```html\n<widget title="W"><b>x');
    expect(live.map((x) => x.type)).toEqual(['markdown', 'widget']);
    expect(live[1]).toMatchObject({ closed: false });
  });

  it('artifact içindeki çitli kodu ve çevreleyen çiti korur/soyar', () => {
    const s = parseRich('<artifact type="markdown" title="Not">\n# Başlık\n```js\nlet x;\n```\n</artifact>');
    expect((s[0] as { content: string }).content).toContain('```js');
    const w = parseRich('<artifact title="A">\n```html\n<p>x</p>\n```\n</artifact>');
    expect((w[0] as { content: string }).content).toBe('<p>x</p>');
  });

  it('widget: başlık, yükseklik sınırı ve kapanış', () => {
    const s = parseRich('<widget title="Hesap" height="5000"><div>x</div></widget> sonra');
    expect(s[0]).toMatchObject({ type: 'widget', title: 'Hesap', height: 900, closed: true, content: '<div>x</div>' });
    expect(s[1]).toMatchObject({ type: 'markdown', text: ' sonra' });
  });

  it('geçersiz tür html\'e düşer, kimlik başlıktan türetilir', () => {
    const s = parseRich('<artifact type="exe" title="Çılgın Oyun">x</artifact>');
    expect(s[0]).toMatchObject({ kind: 'html', id: 'cilgin-oyun' });
  });
});

describe('collectArtifacts', () => {
  it('aynı kimlik sürümleri birleştirir', () => {
    const list = collectArtifacts([
      'selam',
      '<artifact id="a" title="Bir">v1</artifact>',
      'değiştirdim <artifact id="a" title="Bir (v2)">v2</artifact><artifact id="b" type="svg" title="Şekil"><svg/></artifact>',
    ]);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]!.versions.map((v) => v.content)).toEqual(['v1', 'v2']);
    expect(list[0]!.versions.map((v) => v.messageIndex)).toEqual([1, 2]);
    expect(list[0]!.title).toBe('Bir (v2)');
    expect(list[1]!.kind).toBe('svg');
  });
});

describe('buildSandboxDoc', () => {
  const base = { vars: { bg: '#000', text: '#fff' }, dark: true, mode: 'artifact' as const };

  it('CSP ve köprü her türde içeride, CSP içerikten ÖNCE gelir', () => {
    for (const [kind, content] of [['html', '<p>x</p>'], ['svg', '<svg></svg>'], ['mermaid', 'graph TD; A-->B']] as const) {
      const doc = buildSandboxDoc({ ...base, kind, content });
      expect(doc).toContain(SANDBOX_CSP);
      expect(doc).toContain('window.sf=');
      expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf(kind === 'html' ? '<p>x</p>' : kind === 'svg' ? '<svg>' : 'class="mermaid"'));
    }
  });

  it('widget: stil kiti ve tema, koyu/açık palete göre gömülür', () => {
    const wbase = { ...base, mode: 'widget' as const };
    const dark = buildSandboxDoc({ ...wbase, kind: 'html', content: '<div class="sf-card">x</div>' });
    const light = buildSandboxDoc({ ...wbase, dark: false, kind: 'html', content: '<div class="sf-card">x</div>' });
    for (const doc of [dark, light]) {
      expect(doc).toContain('.sf-card');
      expect(doc).toContain('--sf-c1');
      expect(doc).toContain('sf.chartDefaults');
    }
    expect(dark).toContain('--sf-c2:#6aa8ff');
    expect(light).toContain('--sf-c2:#1d63c9');
  });

  it('artifact: uygulama temasına HİÇ dokunulmaz (renk, yazı tipi, arka plan, color-scheme, stil kiti yok)', () => {
    const page = '<!doctype html><html><head><title>T</title></head><body style="background:#123"><h1>Merhaba</h1></body></html>';
    for (const [kind, content] of [['html', page], ['svg', '<svg></svg>'], ['mermaid', 'graph TD; A-->B']] as const) {
      for (const dark of [true, false]) {
        const doc = buildSandboxDoc({ ...base, dark, kind, content });
        expect(doc).not.toContain('--sf-');
        expect(doc).not.toContain('color-scheme');
        expect(doc).not.toContain('font-family');
        expect(doc).not.toMatch(/background:\s*#(000|0b0b0c|fafaf9)/i);
        expect(doc).not.toContain('.sf-card');
        expect(doc).not.toContain('sf-artifact');
        // yalnızca güvenlik ve köprü eklenir
        expect(doc).toContain(SANDBOX_CSP);
        expect(doc).toContain('window.sf=');
      }
    }
    // modelin sayfası olduğu gibi kalır
    expect(buildSandboxDoc({ ...base, kind: 'html', content: page })).toContain('<body style="background:#123"><h1>Merhaba</h1></body>');
    // mermaid temaya göre değişmez
    expect(buildSandboxDoc({ ...base, dark: true, kind: 'mermaid', content: 'graph TD; A-->B' })).toContain("theme:'default'");
  });

  it('tam HTML belgesinin head\'ine enjekte eder', () => {
    const doc = buildSandboxDoc({ ...base, kind: 'html', content: '<!doctype html><html><head><title>T</title></head><body>g</body></html>' });
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<title>'));
    expect(doc.match(/<head/gi)).toHaveLength(1);
  });

  it('mermaid içeriği kaçışlanır', () => {
    const doc = buildSandboxDoc({ ...base, kind: 'mermaid', content: 'A-->B <script>' });
    expect(doc).toContain('A--&gt;B &lt;script&gt;');
  });

  it('CSP dış ağ kaynaklarını yalnızca 3 CDN ile sınırlar ve form/çerçeveyi kapatır', () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("frame-src 'none'");
    expect(SANDBOX_CSP).toContain("form-action 'none'");
    expect(SANDBOX_CSP).not.toMatch(/https:(?!\/\/)/);
    expect(SANDBOX_CSP).not.toContain(' * ');
  });
});

describe('parseSandboxMessage', () => {
  it('yalnızca bizim biçimimizi kabul eder', () => {
    expect(parseSandboxMessage({ sf: 1, type: 'height', h: 320.4 })).toEqual({ sf: 1, type: 'height', h: 320 });
    expect(parseSandboxMessage(JSON.stringify({ sf: 1, type: 'prompt', text: ' merhaba ' }))).toMatchObject({ type: 'prompt' });
    expect(parseSandboxMessage({ type: 'height', h: 10 })).toBeNull();
    expect(parseSandboxMessage('bozuk')).toBeNull();
    expect(parseSandboxMessage({ sf: 1, type: 'height', h: 1e9 })).toEqual({ sf: 1, type: 'height', h: 4000 });
    expect(parseSandboxMessage({ sf: 1, type: 'prompt', text: '   ' })).toBeNull();
  });
});
