import { describe, expect, it } from 'vitest';
import { SKILL_LIMITS, matchSkills } from '@sixfinger/shared';
import { loadBuiltinSkills } from '../src/services/skills.ts';

const errors: string[] = [];
const all = loadBuiltinSkills(undefined, (n, e) => errors.push(`${n}: ${e}`));

const EXPECTED = [
  'static-web-app', 'vite-react-app', 'frontend-design', 'expo-react-native', 'node-express-api', 'python-web-api', 'data-analysis-python', 'cli-tool',
  'project-planning', 'debugging', 'write-tests', 'code-review', 'refactor-safely', 'write-docs', 'security-basics',
];

describe('yerleşik skill kütüphanesi', () => {
  it('hepsi geçerli ve beklenen 15 skill var', () => {
    expect(errors).toEqual([]);
    expect([...all.keys()].sort()).toEqual([...EXPECTED].sort());
  });

  it('kalite kuralları: ad = klasör, açıklama ve tetikleyici sayısı, gövde boyutu, İngilizce açıklama, dosya sınırları', () => {
    for (const [name, b] of all) {
      expect(b.summary.name, name).toBe(name);
      expect(b.summary.description.length, `${name} açıklama`).toBeGreaterThan(60);
      expect(b.summary.description.length, `${name} açıklama`).toBeLessThanOrEqual(SKILL_LIMITS.description);
      expect(b.summary.description, `${name}: "Use when" olmalı`).toMatch(/use (it )?when|use for|use this/i);
      expect(b.summary.triggers.length, `${name} tetikleyici`).toBeGreaterThanOrEqual(8);
      expect(b.body.length, `${name} gövde`).toBeGreaterThan(1_200);
      expect(b.body.length, `${name} gövde`).toBeLessThanOrEqual(12_000);
      expect(Object.keys(b.files).length, `${name} dosya`).toBeLessThanOrEqual(SKILL_LIMITS.files);
    }
  });

  it('git yazma komutu önermez (platform commit eder); skill gövdeleri placeholder bırakmaz', () => {
    const git = /\bgit\s+(commit|push|rebase|merge|switch|checkout\s+-b|branch|remote|config)\b/;
    for (const [name, b] of all) {
      for (const [f, text] of [['SKILL.md', b.body], ...Object.entries(b.files)] as Array<[string, string]>) {
        // "Do not run git commit" gibi yasak cümleleri serbest: yalnızca kod bloğu/komut satırı gibi görünenler yakalanır.
        const bad = text.split('\n').filter((l) => git.test(l) && !/(do not|don't|never|not run|never run|\bno\b|yasak|avoid|instead of)/i.test(l));
        expect(bad, `${name}/${f}`).toEqual([]);
      }
    }
  });

  it('referans edilen ek dosyalar gerçekten var', () => {
    for (const [name, b] of all) {
      for (const m of b.body.matchAll(/name:\s*"([^"]+)",\s*file:\s*"([^"]+)"/g)) {
        const target = all.get(m[1]!);
        expect(target, `${name} → ${m[1]} skill'i yok`).toBeDefined();
        expect(Object.keys(target!.files), `${name} → ${m[1]}/${m[2]}`).toContain(m[2]);
      }
    }
  });

  it('Türkçe ve İngilizce gerçek isteklere doğru skill\'i önerir', () => {
    const cat = [...all.values()].map((b) => b.summary);
    const cases: Array<[string, string]> = [
      ['Tarayıcıda oynanan bir yılan oyunu yapar mısın?', 'static-web-app'],
      ['make a snake game in the browser with html and canvas', 'static-web-app'],
      ['React ile bir todo uygulaması yap', 'vite-react-app'],
      ['arayüzü daha güzel ve modern yap, koyu tema ekle', 'frontend-design'],
      ['Express ile bir REST API yaz', 'node-express-api'],
      ['flask ile küçük bir web servisi', 'python-web-api'],
      ['bu csv dosyasını analiz et ve grafik çiz', 'data-analysis-python'],
      ['komut satırından çalışan bir araç yaz', 'cli-tool'],
      ['sıfırdan bir proje planla ve adım adım geliştir', 'project-planning'],
      ['giriş ekranı çalışmıyor, hata alıyorum', 'debugging'],
      ['login fonksiyonu için birim testleri ekle', 'write-tests'],
      ['yaptığım değişiklikleri incele, code review yap', 'code-review'],
      ['bu fonksiyonu refactor et ama davranış değişmesin', 'refactor-safely'],
      ['README dosyasını yaz', 'write-docs'],
      ['sql injection açığı var mı kontrol et', 'security-basics'],
      ['Expo ile mobil uygulama ekranı ekle', 'expo-react-native'],
    ];
    const miss = cases.filter(([q, want]) => !matchSkills(cat, q, 2).some((s) => s.name === want)).map(([q, want]) => `${want} ← "${q}" → [${matchSkills(cat, q, 2).map((s) => s.name)}]`);
    expect(miss).toEqual([]);
    // sohbet/alakasız mesajlarda ipucu çıkmaz
    for (const q of ['merhaba nasılsın', 'teşekkürler', 'tamam devam et']) expect(matchSkills(cat, q, 2), q).toEqual([]);
  });
});
