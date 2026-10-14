import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createFakeAi } from './helpers.ts';

let app: FastifyInstance;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SixFinger</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const built = await buildApp({ config: loadConfig({ ...process.env, WEB_DIST: dir }), ai: createFakeAi() });
  app = built.app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('web arayüzü yayınlama', () => {
  it('kök ve SPA yolları index.html döner', async () => {
    for (const url of ['/', '/c/123e4567-e89b-12d3-a456-426614174000', '/s/abcdefghij']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<div id="root">');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('hash\'li varlıklar uzun süre önbelleğe alınır', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('olmayan dosya 404, bilinmeyen API yolu JSON 404 döner', async () => {
    expect((await app.inject({ method: 'GET', url: '/missing.png' })).statusCode).toBe(404);
    const api = await app.inject({ method: 'GET', url: '/api/yok' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('not_found');
  });

  it('API sağlık ucu çalışmaya devam eder', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
  });
});
