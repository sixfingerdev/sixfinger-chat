import { describe, expect, it } from 'vitest';
import { listDir, parentDirs } from './code-files.ts';

const paths = ['README.md', 'src/app.ts', 'src/auth/login.ts', 'src/auth/login.test.ts', 'src/Util.ts', 'docs/a.md'];

describe('listDir', () => {
  it('kökte klasörleri ve dosyaları ayırır, sıralar', () => {
    expect(listDir(paths, '')).toEqual({ dirs: ['docs', 'src'], files: ['README.md'] });
  });
  it('alt klasörü listeler (sonda / olsa da)', () => {
    expect(listDir(paths, 'src')).toEqual({ dirs: ['auth'], files: ['app.ts', 'Util.ts'] });
    expect(listDir(paths, 'src/auth/')).toEqual({ dirs: [], files: ['login.test.ts', 'login.ts'] });
  });
  it('olmayan klasör boş döner; benzer adlı klasörle karışmaz', () => {
    expect(listDir(paths, 'yok')).toEqual({ dirs: [], files: [] });
    expect(listDir(['srcx/a.ts', 'src/b.ts'], 'src')).toEqual({ dirs: [], files: ['b.ts'] });
  });
});

describe('parentDirs', () => {
  it('üst klasör zincirini verir', () => {
    expect(parentDirs('src/auth/login.ts')).toEqual(['', 'src', 'src/auth']);
    expect(parentDirs('README.md')).toEqual(['']);
  });
});
