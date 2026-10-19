# Common bug patterns to look for

Use grep to find candidates, then read the context before reporting. In commands below `$B` is the base commit: `B="$(cat .git/sixfinger/base 2>/dev/null || echo HEAD)"`.

## Control flow and errors
- Missing `await` on a promise (result used as value, error unhandled). No reliable grep: read each async function and check every call to an async function.
- `async` callback inside `forEach` (not awaited). Fix: `for...of` or `Promise.all(map(...))`.
- Empty `catch {}` or `except: pass` that hides failure. Find: `grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*\}|except.*:\s*pass" .`
- Error caught and logged but the function continues as if it worked.
- Early `return` that skips cleanup. `finally` missing.
- Function returns different types on different paths (`null` vs `[]`).

## Values and types
- `==` vs `===`; truthiness checks that fail on `0`, `""`, `false` (`if (!count)`).
- `null`/`undefined` access: optional field, `.find()` result, `Map.get()`, regex `match()` result, `JSON.parse` result.
- Off-by-one: `<=` vs `<`, `slice(0, n-1)`, last element, empty list (`arr[arr.length-1]`, `Math.max(...[])`).
- Floating point money/equality; integer overflow; `parseInt("08")`; string vs number compare (`"10" < "9"`).
- Mutating an argument or shared default (`def f(x=[])`, `Object.assign(defaultObj, ...)`, `sort()` on shared array mutates it).
- Shallow copy where a deep copy is needed.
- Date/time: timezone, DST, month index starting at 0, comparing Date objects with `==`.
- Unicode: `.length` vs code points, case folding, normalization.

## Concurrency and state
- Shared mutable state across requests (module-level variable used per user).
- Read-modify-write without lock/transaction.
- Stale closure / stale state in UI hooks; missing dependency in `useEffect`.
- Event listeners, intervals, subscriptions never removed.
- Retry without backoff or idempotency; duplicate side effects on retry.

## Resources
- Opened file/connection/stream not closed on error path.
- Large file read fully into memory.
- N+1 queries inside a loop; missing index on a new query filter.
- Unbounded recursion; missing base case.

## API and data
- Changed function signature or return shape: grep all callers (`grep -rn "name(" .`).
- Renamed/removed field still used elsewhere or in stored data / migrations.
- Migration not reversible or locks a big table; no default for a new NOT NULL column.
- Response status code mismatched with the body (200 on error).
- Pagination without stable sort order.

## Tests
- Test has no assertion, asserts a constant, or only checks "does not throw".
- Test mocks the very function under test.
- `.only`, `.skip`, `xit`, `@pytest.mark.skip`, `fdescribe` left in. Find: `grep -rnE "\.only\(|\.skip\(|xit\(|xdescribe\(|fdescribe\(|pytest\.mark\.skip" .`
- Test depends on current time, random, network, or execution order.
- Snapshot updated blindly with the code change.
- New branch / error path with no test.

## Leftovers
- `console.log`, `print(`, `debugger`, `TODO`/`FIXME`, commented-out code, hard-coded local paths or URLs, test credentials.
  Find (changed lines only): `git diff "$B" | grep -nE "^\+.*(console\.log|debugger|TODO|FIXME|print\()"`
