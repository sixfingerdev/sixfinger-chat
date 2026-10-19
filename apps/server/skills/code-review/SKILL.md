---
name: code-review
description: Review code changes (the current diff, a branch, or named files) and report prioritized findings with file:line, reason and suggested fix, without modifying any file. Use when the user asks to review, check, audit or find bugs in changes. Do not use for implementing fixes or for writing new code.
triggers: [incele, inceleme, review, code review, gözden geçir, kontrol et, değişiklikleri incele, hata bul, bug var mı, kod kalitesi, diff, pull request, eleştir, sorun var mı, denetle, feedback]
---

# Code review

Read-only job. Find real problems in the changes and report them briefly.

## When to use
- User says "incele", "review", "kontrol et", "gözden geçir", "bug var mı", "bu değişiklikte sorun var mı".
- User wants feedback on a diff, a branch, or specific files.

## When NOT to use
- User wants the problems fixed: review first, report, then fix only if asked.
- User asks only for a security audit of the whole project: use `security-basics` for the checklist.

## Hard rules
- Do NOT edit, write, delete or format any file. Do NOT run `git add/commit/checkout/stash/reset`. Only read-only git.
- Do NOT change the review into a rewrite. Report; the user decides.
- Report only what you verified by reading code or running a command. If unsure, say "emin değilim" / "not sure" and say what would confirm it.
- Never invent line numbers. Copy them from `read` or `grep -n` output.

## Workflow
1. Define scope. Run in one `bash` call:
```
B="$(cat .git/sixfinger/base 2>/dev/null || echo HEAD)"; git status --short; echo ---; git diff --stat "$B"; echo ---; git ls-files --others --exclude-standard; echo ---; git log --oneline "$B"..HEAD | head -n 20
```
   - `$B` is the commit where this session started. `git diff "$B"` shows committed + uncommitted changes of tracked files. Untracked files (last list) are new files: read them in full.
   - If the user named files or a path, review those instead. If the diff is empty and nothing is named, ask the user what to review.
2. Plan with `todo` if more than 5 files changed. Review one file at a time.
3. Read the diff per file: `git diff -U8 "$B" -- <path>`. Then `read` the changed function/file around it. A diff hides callers and invariants: use `grep -rn "<symbol>" --include=<ext> .` to find who calls a changed function or reads a changed field.
4. Check in this order (stop to report a higher-priority issue first):
   1. **Correctness / security / data loss**: wrong logic, off-by-one, null/undefined, wrong operator, ignored error or promise, injection, missing auth check, secret in code, destructive operation without guard, race condition, resource leak.
   2. **Missing edge cases**: empty input, huge input, zero/negative, unicode, timezone, concurrent calls, network failure, partial failure.
   3. **Broken or missing tests**: changed behavior with no test, test that cannot fail (no assertion), test that depends on order/time/network, deleted or skipped test.
   4. **Readability**: only if it hides bugs or is clearly confusing. Skip style nits that a formatter/linter handles.
   For the checklists: `skill {name: "code-review", file: "references/security-checklist.md"}` and `skill {name: "code-review", file: "references/common-bugs.md"}`. Load them only when the change touches that area.
5. Run the project checks that exist and are fast, so you can say what you verified. Find the commands in `package.json` scripts / `Makefile` / `SIXFINGER.md`, e.g. `npm test`, `npx tsc --noEmit`, `npm run lint`, `python3 -m pytest -q`. Add `< /dev/null` and `CI=1`. If installs are blocked or a check cannot run, say so; do not skip silently. Also run `git diff --check "$B"` (whitespace errors, leftover conflict markers).
6. Confirm each finding before listing it: re-read the exact lines. Drop it if you cannot point to the failing input or scenario.
7. Write the report (format below).

## Severity labels
- `[blocker]` wrong result, crash, security hole, data loss. Must fix.
- `[major]` real bug in an edge case, missing test for risky logic, resource leak.
- `[minor]` small risk or maintainability issue worth fixing.
- `[nit]` taste. Max 3 of these; skip if there are blockers.
- `[?]` not sure. State what to check.

## Output format
Keep it short. Findings sorted by severity:
```
## Summary
<1-2 sentences: what changed, overall verdict>

## Findings
1. [blocker] src/auth.ts:42 — <what is wrong and the input that breaks it>. Fix: <concrete change, 1-3 lines of code or a clear instruction>.
2. [major] src/db.ts:88 — ...
3. [?] src/cache.ts:15 — not sure: <why>. Check: <command or test>.

## Checked
- npm test: passed (31 tests) | tsc --noEmit: passed | lint: not configured
- Not checked: <what you could not run and why>
```
- One finding = one line group. No long essays. No more than ~10 findings; merge repeats ("same pattern in a.ts:3, b.ts:9").
- Each finding has `path:line`, the reason, and a fix.

## Saying "looks good"
- Say "iyi görünüyor / looks good" ONLY if: you read every changed file, you ran the available checks and they passed, and you found no blocker/major issue.
- Then still list what you checked and what you could not check (no tests for X, no network, etc.).
- If checks were not runnable, say "okudum, çalıştıramadım" instead of "looks good".

## Avoid false positives
- Do not flag code that was not changed unless the change breaks it.
- Do not flag a style the repo already uses everywhere.
- Before claiming "X is undefined / never called / unused", grep for it (including tests, config, dynamic use).
- Before claiming a type error, run the type checker.
- Do not recommend new dependencies or big rewrites.

## Final answer
Reply in the user's language with the Summary, Findings and Checked blocks. No files were changed: say so in one line. Offer to fix the blockers if the user wants.
