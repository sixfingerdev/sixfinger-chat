import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.app.close();
});

describe('herkese açık skill kataloğu', () => {
  it('index.json yerleşik skill\'leri SKILL.md ve sürümle listeler (oturumsuz)', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/skills/index.json' });
    expect(r.statusCode).toBe(200);
    const { skills } = r.json();
    expect(skills.length).toBeGreaterThan(3);
    for (const s of skills) {
      expect(s.files).toContain('SKILL.md');
      expect(s.version).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('listelenen dosyayı verir; olmayanı ve yol dışına çıkışı reddeder', async () => {
    const { skills } = (await env.app.inject({ method: 'GET', url: '/api/skills/index.json' })).json();
    const s = skills[0];
    const ok = await env.app.inject({ method: 'GET', url: `/api/skills/${s.name}/SKILL.md` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('name:');
    expect((await env.app.inject({ method: 'GET', url: `/api/skills/${s.name}/yok.md` })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'GET', url: `/api/skills/${s.name}/..%2F..%2Fpackage.json` })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'GET', url: '/api/skills/yok-skill/SKILL.md' })).statusCode).toBe(404);
  });
});
