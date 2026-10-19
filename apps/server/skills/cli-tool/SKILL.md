---
name: cli-tool
description: Build a command-line tool in Node.js (or Python) that reads files or stdin, has flags and --help, returns proper exit codes and ships with tests. Use when the user asks for a CLI, a terminal script, a command-line utility, a converter or any program run as `tool --flag file`. Do not use for web servers (use node-express-api or python-web-api) or browser apps.
triggers: [komut satırı, cli, terminal aracı, komut satırı aracı, command line, command-line, script, betik, bash script, argüman, bayrak, flag, stdin, stdout, yardım metni, --help, çıkış kodu, exit code, dönüştürücü, converter, utility, araç yaz, npm paketi, bin, pip paketi, argparse]
---

# Command-line tool (Node.js first, Python alternative)

## When to use
- The user wants a program they run in a terminal: `tool [options] [file]`, reads a file or stdin, prints to stdout.
- Converters, counters, formatters, log filters, generators, small automation.

## When NOT to use
- HTTP APIs: `node-express-api` / `python-web-api`. Browser pages: `static-web-app`.
- Existing project already has a CLI framework (commander, yargs, click, typer): extend it, do not add a second one.

## Workflow
1. Decide language: follow the repo (package.json -> Node, pyproject/requirements -> Python). New and unsure: Node 20+ with no dependencies (`node:util` `parseArgs`). Python: `argparse` (stdlib).
2. Write a short `todo`: interface (flags, input, output), core logic, wiring, tests, verify.
3. Define the interface first (write it in your plan): arguments, flags (long + short), defaults, what goes to stdout vs stderr, exit codes.
4. Create files (Node layout), one `write` call each:
   - `package.json`: `"type": "module"`, `"bin": {"<name>": "bin/<name>.js"}`, `"scripts": {"test": "node --test"}`.
   - `bin/<name>.js`: first line `#!/usr/bin/env node`; parse args, read input, call the pure function, print, set `process.exitCode`.
   - Keep the counting/convert logic in a pure function (export it) so tests can call it without a process.
   - `test/cli.test.js`: `node:test` + `spawnSync('node', ['bin/<name>.js', ...args], {input})`.
   A complete, tested example: `skill {name: "cli-tool", file: "references/node-cli-example.js"}` and its test `skill {name: "cli-tool", file: "references/node-cli-test-example.js"}`. Copy the structure, change the logic.
5. Run it by hand with real input, then run the tests: `node --test`. Fix until green.
6. If the user may want to share it: `share_file` the entry file (or a zip: `zip -r <name>.zip bin package.json README.md`).

## Interface rules
- `--help` / `-h`: usage text with 1-line description, usage line, every option. Exit code 0, text on stdout.
- Unknown flag or bad value: message + usage on **stderr**, exit code **2**. Runtime failure (missing file, parse error): short message on stderr, exit code **1**. Success: **0**.
- Input: positional path argument, or stdin when no path is given (`readFileSync(path ?? 0, 'utf8')` reads fd 0 = stdin). Never wait on a TTY prompt: this environment has no TTY.
- Output: machine-friendly by default (plain lines). Add `--json` only if the user asked for it.
- Never print stack traces to the user; print `tool: <what went wrong>`.
- Respect pipes: write results with `process.stdout.write`; no colors unless stdout is a TTY (`process.stdout.isTTY`).

## Python variant (stdlib only)
```python
#!/usr/bin/env python3
import argparse, sys

def main(argv=None):
    p = argparse.ArgumentParser(prog="wc-lite", description="Count lines, words and characters.")
    p.add_argument("file", nargs="?", help="input file (default: stdin)")
    p.add_argument("-l", "--lines", action="store_true")
    args = p.parse_args(argv)          # bad flags exit with code 2 automatically
    try:
        text = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    except OSError as e:
        print(f"wc-lite: cannot read {args.file}: {e.strerror}", file=sys.stderr)
        return 1
    print(len(text.splitlines()))
    return 0

if __name__ == "__main__":
    sys.exit(main())
```
Tests: `python3 -m unittest discover -s tests` with `subprocess.run([sys.executable, "tool.py", ...], input=..., capture_output=True, text=True)`.

## Rules / Do not
- Do not add dependencies for argument parsing or colors. `parseArgs` / `argparse` are enough.
- Do not read the whole file into memory when the user said the input is huge: stream line by line (`readline.createInterface`, `for line in file`).
- Do not hard-code absolute paths. Do not write to the input file unless the user asked for in-place edits (and then offer `--dry-run`).
- Do not leave `TODO` or placeholder logic. Do not say it works before you ran it.
- Do not run interactive commands (no `npm init` without `-y`).

## Verify
1. `node --check bin/<name>.js` (or `python3 -m py_compile tool.py`).
2. `printf 'sample\n' | node bin/<name>.js` prints the expected result; with a file argument too.
3. `node bin/<name>.js --help` exits 0; `node bin/<name>.js --nope; echo $?` prints 2.
4. `node --test` is green (at least: normal input, empty input, bad flag, missing file).

## Final answer
Say: what the tool does, how to run it (`node bin/<name>.js --help`; after `npm link` as `<name>`), the flags in one line each, exit codes, and that tests pass (with the command).
