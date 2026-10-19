---
name: write-tests
description: Write and run tests that check behavior - detect the project's test framework and style, cover normal, edge and error cases, mock only external boundaries, go red to green, run subsets quickly. Falls back to node:test or unittest when no framework exists or installs are blocked. Use when asked to add, write or improve tests or coverage. Do not use for fixing the bug itself.
triggers: [test, testler, test yaz, birim test, unit test, testi yaz, test ekle, kapsam, coverage, jest, vitest, pytest, mocha, unittest, go test, regresyon, regression, testle, doğrula, test coverage, test case, spec, TDD]
---

# Writing tests

## When to use
- "Write tests for X", "add tests", "increase coverage", "test this function / API".
- Adding a regression test after a bug fix (called from `debugging`).

## When NOT to use
- The code under test is broken and the user wants it fixed: use `debugging` first.
- Pure manual checking of a web page: use `preview`.

## Workflow

### 1. Detect the framework
Run these (independent, one turn):
```
cat package.json 2>/dev/null | head -n 60
ls pytest.ini pyproject.toml setup.cfg tox.ini go.mod Cargo.toml 2>/dev/null
glob **/*.test.* , **/*.spec.* , **/test_*.py , **/*_test.go , tests/ , __tests__/
```
- Node: look at `scripts.test` and `devDependencies` (vitest, jest, mocha, ava, node:test).
- Python: `pytest` (config or `tests/test_*.py`) or `unittest`.
- Go: `*_test.go` next to the code. Rust: `#[cfg(test)]` / `tests/`.
- Use what the project already uses. Never add a second framework.

### 2. Copy the style of existing tests
- `read` one or two existing test files: file location, naming, imports, describe/it vs test(), fixtures, assertion style.
- Put new tests where the project puts them (next to the source or in `tests/`), same naming pattern.
- No existing tests: see "No framework" below.

### 3. Read the code under test
- `read` the function / module. List its inputs, outputs, side effects, errors it throws.
- Test the public behavior (inputs -> outputs, visible effects). Do not test private helpers or exact internal calls.

### 4. Plan cases (use `todo` if more than ~5 cases)
For each unit cover:
- **Normal**: typical valid input -> expected output.
- **Edge**: empty, zero, one item, max, boundaries, unicode / long strings, duplicates, order.
- **Error**: invalid input, missing data, thrown errors / rejected promises / HTTP 4xx. Assert the specific error, not just "throws".
- Bug fix: the exact input that failed before.

### 5. Write the tests
- One behavior per test. Name says what and when: `returns 0 for an empty cart`, `rejects when email is invalid`, `adds item and updates total`. No `test1`, no `works`.
- Arrange / Act / Assert, 3-10 lines each. Expected values written as literals computed by hand, not by re-running the same logic in the test.
- Tests are independent: no shared state, no order dependence; reset in `beforeEach` / fixtures. Temp files go to a temp dir.
- Deterministic: fix time (fake timers / pass a date), seed randomness, no `sleep`, no real network.
- Async: `await` everything; return the promise.
- Mock only boundaries you do not control: network, clock, filesystem, database, random, third-party SDK. Do not mock the code under test or its pure helpers. Prefer a small fake over a deep mock chain. Assert outcomes, not call counts (unless the call IS the behavior).
- Write the file with `write`. Keep each test file under ~300 lines; split by module.

### 6. Run: red then green
- Run the new tests first. New tests for existing correct code should pass at once; if one fails, decide: bug in code (report / `debugging`) or wrong expectation (fix the test with evidence).
- Regression or TDD test: run BEFORE the fix and see it fail for the right reason (read the message), then fix, then see it pass.
- Then run the full suite once. Show the summary line.

### 7. Quick commands (always non-interactive)
| Stack | All | One file | One test by name |
|---|---|---|---|
| npm script | `CI=1 npm test 2>&1 \| tail -n 40` | `CI=1 npm test -- path/to/a.test.js` | `CI=1 npm test -- -t "name"` (jest/vitest) |
| vitest | `npx vitest run` | `npx vitest run path/a.test.ts` | `npx vitest run -t "name"` |
| jest | `CI=1 npx jest` | `CI=1 npx jest path/a.test.js` | `CI=1 npx jest -t "name"` |
| mocha | `npx mocha` | `npx mocha path/a.test.js` | `npx mocha -g "name"` |
| node:test | `node --test` | `node --test path/a.test.js` | `node --test --test-name-pattern="name"` |
| pytest | `python3 -m pytest -q` | `python3 -m pytest -q tests/test_a.py` | `python3 -m pytest -q -k name` |
| unittest | `python3 -m unittest discover -v` | `python3 -m unittest tests.test_a` | `python3 -m unittest tests.test_a.Class.test_name` |
| go | `go test ./...` | `go test ./pkg/` | `go test ./pkg/ -run TestName` |
- Never use watch mode (`--watch`, bare `vitest`, `jest --watch`). Add `2>&1 | tail -n 60` to keep output short; use `--bail` / `-x` to stop at the first failure.
- Slow machine: use `timeout_seconds` 300+ for big suites or run in background and read `job_output`.

## No framework yet
Use the lightest option; install nothing if you can avoid it.
- **Node (any version >= 18)**: built-in runner, no install.
```js
// math.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './math.js';

test('adds two numbers', () => { assert.equal(add(2, 3), 5); });
test('throws on non-number', () => { assert.throws(() => add('a', 1), /number/); });
```
  Run: `node --test`. For CommonJS use `const { test } = require('node:test')`. Add `"test": "node --test"` to package.json scripts.
- **Python**: `unittest`, no install. File `tests/test_x.py` with `class TestX(unittest.TestCase)`; run `python3 -m unittest discover -v`. (If pytest is already installed and allowed, `python3 -m pytest -q` also works with plain `assert` functions.)
- **Go / Rust**: built in (`go test`, `cargo test`).
- Browser-only code with no framework: move logic into a plain module and test it with `node:test`; do not install a headless browser.
- Only add vitest / jest / pytest when the user asks and the network allows (`npm install -D vitest --yes`, `timeout_seconds` 600+). If the install is blocked, fall back to `node:test` / `unittest` and say so.

## Rules (hard)
- NEVER make a test pass by weakening it: no deleting or loosening assertions, no `.skip` / `xit` / `@pytest.mark.skip`, no try/catch that swallows failures, no changing the expected value to whatever the code returns without checking it is correct, no mocking the thing under test.
- A failing test means: the code is wrong (fix or report it) or the expectation is wrong (prove it from the spec / requirement, then fix the test). Say which.
- Do not change production code just to make testing easier unless needed (a small export or injectable dependency is fine; mention it).
- No tests that depend on the network, real time, random values or the order of other tests.
- Do not write tests that only assert a mock was called, or snapshot huge outputs you did not read.
- Do not claim "tests pass" without running them and showing the summary.
- No git commit / push.

## Verify
1. New tests run and pass: command + summary line.
2. Full suite still passes (or the failures were already there: say which).
3. Sanity check at least one new test can fail: temporarily flip an expected value, or run it against the pre-fix code, then restore it.

## Final answer
Short, in the user's language:
- Test files added / changed (`path`) and how many cases (normal / edge / error).
- The exact command to run them and the result line.
- Bugs or doubts found in the code under test.
- What is not covered.
