#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const HELP = `Usage: wc-lite [options] [file]

Count lines, words and characters of a file or stdin.

Options:
  -l, --lines   print the line count
  -w, --words   print the word count
  -c, --chars   print the character count
  -h, --help    show this help
`;

export function count(text) {
  return { lines: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), words: text.split(/\s+/).filter(Boolean).length, chars: [...text].length };
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { lines: { type: 'boolean', short: 'l' }, words: { type: 'boolean', short: 'w' }, chars: { type: 'boolean', short: 'c' }, help: { type: 'boolean', short: 'h' } } });
  } catch (err) {
    process.stderr.write(`wc-lite: ${err.message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  let text;
  try {
    text = readFileSync(positionals[0] ?? 0, 'utf8');
  } catch (err) {
    process.stderr.write(`wc-lite: cannot read ${positionals[0] ?? 'stdin'}: ${err.code ?? err.message}\n`);
    return 1;
  }
  const c = count(text);
  const picked = ['lines', 'words', 'chars'].filter((k) => values[k]);
  process.stdout.write((picked.length ? picked : ['lines', 'words', 'chars']).map((k) => c[k]).join(' ') + '\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
