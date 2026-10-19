import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = (args, input) => spawnSync('node', ['bin/wc-lite.js', ...args], { input, encoding: 'utf8' });

test('counts words from stdin', () => {
  const r = run(['--words'], 'bir iki\nüç dört beş\n');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '5');
});
test('unknown flag exits with 2', () => {
  const r = run(['--nope'], '');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
test('missing file exits with 1', () => {
  assert.equal(run(['/does/not/exist']).status, 1);
});
