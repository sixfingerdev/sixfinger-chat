import { describe, expect, it } from 'vitest';
import type { MessageDTO } from './types.ts';
import { codeTranscriptMarkdown } from './code-export.ts';

const msg = (over: Partial<MessageDTO>): MessageDTO => ({
  id: 'x', chatId: 'c', parentId: null, role: 'assistant', content: '', reasoning: '', status: 'complete', model: null, attachments: [], feedback: null, reasoningMs: null, parts: [], createdAt: '', ...over,
});

describe('codeTranscriptMarkdown', () => {
  it('mesajları, araç özetlerini, commit, PR ve planı yazar; düşünceyi atar', () => {
    const md = codeTranscriptMarkdown(
      { title: 'Giriş hatası', repo: 'octo/alpha', branch: 'sixfinger/alpha-1', base: 'main', prUrl: 'https://github.com/octo/alpha/pull/7' },
      [
        msg({ role: 'user', content: 'Boş şifreyi düzelt' }),
        msg({
          parts: [
            { type: 'reasoning', text: 'düşünüyorum', ms: 10 },
            { type: 'text', text: 'Bakıyorum.' },
            { type: 'tool', id: '1', name: 'bash', args: {}, status: 'done', meta: { command: 'npm test\nsecond', exitCode: 1 } },
            { type: 'tool', id: '2', name: 'edit', args: {}, status: 'done', meta: { files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] } },
            { type: 'tool', id: '3', name: 'commit', args: {}, status: 'done', summary: 'abc1234', meta: { sha: 'abc1234def', subject: 'fix: boş şifre' } },
            { type: 'tool', id: '4', name: 'pull_request', args: {}, status: 'done', meta: { number: 7, url: 'https://github.com/octo/alpha/pull/7' } },
            { type: 'text', text: 'Bitti.' },
            { type: 'tool', id: '5', name: 'exit_plan_mode', args: {}, status: 'done', meta: { plan: '1. a\n2. b' } },
          ],
        }),
      ],
      { you: 'Sen', ai: 'SixFinger' },
    );
    expect(md).toContain('# Giriş hatası');
    expect(md).toContain('octo/alpha · `sixfinger/alpha-1` (base `main`) · https://github.com/octo/alpha/pull/7');
    expect(md).toContain('## Sen\n\nBoş şifreyi düzelt');
    expect(md).not.toContain('düşünüyorum');
    expect(md).toContain('- `$ npm test` (exit 1)\n- Edited `src/a.ts` (+3 −1)\n- Commit `abc1234` fix: boş şifre\n- Pull request #7: https://github.com/octo/alpha/pull/7');
    expect(md).toContain('Bakıyorum.');
    expect(md).toContain('> **Plan**\n> 1. a\n> 2. b');
    expect(md.endsWith('\n')).toBe(true);
  });
});
