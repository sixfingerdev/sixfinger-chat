import { describe, expect, it } from 'vitest';
const DEFAULT_SETTINGS = { customName: '', about: '', instructions: '', defaultPersona: 'default', memoryEnabled: false };
import { buildSystemPrompt } from '../src/services/prompt.ts';
import { buildCodeSystemPrompt } from '../src/services/code-prompt.ts';
import { LOGO_SVG, SITE_URL } from '../src/services/brand.ts';

describe('marka tanıtımı sistem istemlerinde', () => {
  it('sohbet istemi adresi, ürün bölümlerini ve logo SVG\'sini içerir', () => {
    const p = buildSystemPrompt({ locale: 'tr', personaId: 'default', settings: DEFAULT_SETTINGS, memories: [], displayName: '' });
    expect(p).toContain(SITE_URL);
    expect(p).toContain(LOGO_SVG);
    expect(p).toContain('Code');
  });

  it('Code istemi adresi, logo SVG\'sini ve SIXFINGER.md\'yi içerir', () => {
    const p = buildCodeSystemPrompt({ locale: 'en', repo: 'a/b', baseBranch: 'main', workBranch: 'sixfinger/x', network: 'none', allowedDomains: [], diskMb: 512 });
    expect(p).toContain(SITE_URL);
    expect(p).toContain(LOGO_SVG);
    expect(p).toContain('SIXFINGER.md');
  });
});
