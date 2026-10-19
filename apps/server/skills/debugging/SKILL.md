---
name: debugging
description: Systematic bug fixing - reproduce, read the error, form a hypothesis, test it with the smallest experiment, prove the cause, apply the smallest fix, re-run the same command, add a regression test. Use when something fails, crashes, throws an error, prints wrong output or "does not work". Do not use for building new features or refactoring.
triggers: [hata, hatayı düzelt, çalışmıyor, bug, error, exception, crash, çöküyor, patlıyor, sorun, fix, broken, not working, doesn't work, failing, test fails, stack trace, traceback, undefined, null, beyaz ekran, açılmıyor, debug, hata ayıkla]
---

# Debugging: prove the cause, then fix

## When to use
- Something crashes, throws, fails a test or build, or gives a wrong result.
- The user says "it does not work" / "çalışmıyor" / "hata veriyor".

## When NOT to use
- New feature from scratch: `project-planning`. Only adding tests: `write-tests`.

## Workflow

### 1. Reproduce
- Get the exact command or input that fails. Run it with `bash` and read the FULL error. Examples: `npm test 2>&1 | tail -n 60`, `node app.js 2>&1 | head -n 40`, `python3 main.py 2>&1 | tail -n 40`.
- Servers or watchers: `background=true`, then `job_output`. Never interactive commands (use `CI=1`, `--yes`, `< /dev/null`).
- If you cannot reproduce it, ask what the user did (one `ask_user` only if truly needed), or write a tiny script that triggers the code path.
- Write the failing command down in your first todo item: "Reproduce: `<cmd>` fails with `<message>`".
- For 3+ steps, use `todo`: reproduce, find cause, fix, verify, regression test.

### 2. Read the error properly
- First line = what. Stack trace = where. Read the first frame that is YOUR code (not `node_modules`, not stdlib).
- Jump to it: `read` with the file and a window around the line. Read the lines that produce the values, not just the failing line.
- Copy exact messages into `grep` to find where they are produced: `grep -rn "exact message" src`.
- A build error list: fix the FIRST error only, re-run; later errors are often consequences.

### 3. Hypothesis, then the smallest experiment
- State one hypothesis in one line: "`user` is undefined because `find` returns nothing for id `'3'` (string vs number)."
- Test it with the cheapest check:
  - print the actual values: `console.log(JSON.stringify(x))` / `print(repr(x))`, with a label;
  - run a one-liner: `node -e '...'`, `python3 -c '...'`;
  - `grep` for all callers / definitions; `read` the callee.
- One experiment = one hypothesis. Do not change code and add logs at once for different guesses.
- Note the result. If it contradicts the hypothesis, drop it and form a new one from the evidence.

### 4. Prove the cause
- You know the cause when you can say WHY, with output that shows it: "log shows `typeof id` is `string`, the array holds numbers".
- Do not fix by guessing. Do not wrap in `try/catch`, add `?.` or default values just to silence the error, unless the evidence shows that case is legitimate.
- Check the neighbors: does the same mistake exist elsewhere? `grep` the pattern.

### 5. Smallest fix
- Change the minimum lines that remove the cause. No refactoring, no reformatting, no unrelated cleanup.
- Use `edit` with text copied from a fresh `read`.
- Remove your debug logs afterwards: `grep -rn "DEBUG\|console.log(\"\\[dbg" src | head`.

### 6. Verify with the SAME command
- Run the exact failing command from step 1. It must now pass or print the right result. Show the output.
- Then run the wider checks: the full test suite / build / lint if they exist and are fast.
- Never say "it should work now". Report what you ran and what it printed.

### 7. Regression test
- Add a test that fails without the fix and passes with it (see the `write-tests` skill). Put it next to the existing tests, same style.
- No test framework and the bug is small: still add a minimal one (`node:test` / `unittest`), or explain why not.
- Optional proof: undo the fix mentally or by running the test against the old logic once if cheap.

## If the fix did not work
1. Do not stack another guess on top. Undo the failed change (`edit` it back).
2. Re-read the error: is it the SAME error or a new one? A new error means progress; restart at step 2 for it.
3. Challenge your assumptions: wrong file being run? stale build / cache? wrong working directory? env var missing? a different version installed? Check with `which node`, `node -v`, `pwd`, `ls dist`, `env | grep NAME`.
4. Add logging at the boundaries (input of the function, output of the previous step) and bisect: find the last point where the data is still correct.
5. Do NOT try the same approach more than 3 times. After 3 failed attempts: change strategy (simplify to a minimal repro file, bisect by deleting code, read library docs / source via `task` sub-agent or `web_search`).
6. If still stuck, stop and tell the user: what you tried, what the evidence shows, what you need. Do not pretend.

## Common error classes (quick hints)
- **undefined / null / NoneType**: print the object one step earlier. Typical: wrong key name, async data not loaded yet, array `find` found nothing, id type string vs number, DOM element queried before it exists (script runs before the HTML; use `defer` / `type="module"`).
- **async / await**: missing `await` gives a Promise (prints `Promise { <pending> }`); `forEach` with `async` does not wait (use `for...of` or `Promise.all`); unhandled rejection hides the real error; callbacks called twice.
- **Version mismatch**: `node -v`, `python3 --version`, check `engines` in package.json; ESM vs CJS (`require is not defined` / `Cannot use import statement` -> `"type": "module"` or file extension `.mjs`/`.cjs`); API changed in a major version: read the installed version in `node_modules/<pkg>/package.json`.
- **Path / directory**: relative paths resolve from the CURRENT directory, not the file. Check `pwd`, `ls`. Use `path.join(__dirname, ...)` / `Path(__file__).parent`. Case sensitivity on Linux (`App.js` != `app.js`). In web previews use relative URLs.
- **Port / server**: `EADDRINUSE` -> a previous server still runs (`job_kill` it, or pick another port). "Connection refused" -> server not started or crashed (`job_output`), or bound to wrong host (listen on `0.0.0.0`). Read the port from `process.env.PORT` when given.
- **Missing dependency**: `Cannot find module 'x'` / `ModuleNotFoundError` -> not installed or not in package.json: `ls node_modules/x`, `npm ls x 2>&1 | head`. Install only if the network allows; if blocked, stop and tell the user or use a built-in alternative.
- **Off-by-one / boundaries**: loops `<` vs `<=`, empty list, last element, slice end is exclusive, 0-based vs 1-based. Test with sizes 0, 1, 2.
- **Wrong output but no error**: print intermediate values, compare against a hand-computed small example; check mutation of shared objects and shallow copies; floating point (`0.1+0.2`), dates and time zones, integer vs float division.
- **Works once, fails second time**: leftover state (global variables, cache, file written earlier, DB rows). Reset state and rerun.
- **Browser page blank**: no console to read here. Run `node --check` on scripts, look for a syntax error, wrong script path, `fetch` with a root-absolute URL, `localStorage` throwing in preview (wrap in try/catch).

## Rules
- Reproduce first, fix second. Evidence before edits.
- One change at a time; re-run after each.
- Never weaken a test, delete an assertion or skip a failing test to get green (see `write-tests`).
- Never claim success without showing the command output.
- Do not repeat an identical failing command; change something or learn something between runs.
- No git commit / push; read-only `git diff` / `git log` is fine for "what changed recently" (`git log -n 5 --stat`).

## Final answer
Short, in the user's language:
- Cause (1-2 lines, with `path:line`).
- Fix (what changed).
- Verification: the command you re-ran and its result; regression test added.
- Anything left open or risky.
