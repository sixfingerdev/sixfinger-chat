---
name: refactor-safely
description: Restructure, rename, split or clean up existing code without changing its behavior, in small steps verified by tests after each step. Use when the user asks to refactor, simplify, rename, extract, split a big file, or remove duplication. Do not use when the request also adds a feature or fixes a bug; do those separately.
triggers: [refactor, refaktör, refactoring, sadeleştir, temizle, cleanup, clean up, simplify, rename, adlandır, extract, böl, tekrar eden kod, duplicate, restructure, düzenli hale getir, spagetti, okunabilir, modülerleştir]
---

# Refactor safely

Refactor = same behavior, better structure. If behavior changes, it is not a refactor.

## When to use
- "refactor et", "sadeleştir", "dosyayı böl", "fonksiyonu ayır", "şu ismi değiştir", "tekrar eden kodu birleştir", "clean up".

## When NOT to use
- The request adds a feature or fixes a bug. Do the refactor first as its own step (or after), never mixed. If the user asked for both, say: "Önce davranışı değiştirmeden düzenleyeceğim, sonra özelliği ekleyeceğim" and keep them in separate steps in `todo`.

## Rules
- Keep behavior identical: same inputs give the same outputs, same errors, same side effects.
- Keep the public API: exported names, function signatures, CLI flags, HTTP routes, file formats, DB columns, config keys, event names. If you must change one, list every caller and tell the user first.
- One kind of change per step (rename, OR extract, OR move). Never reformat unrelated code.
- Do not fix bugs you notice while refactoring. Write them down and report them at the end.
- Do not add dependencies. Do not delete tests to make them pass.

## Workflow
1. **Understand scope.** `read` the target file(s). Find all users:
```
grep -rnw --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build 'targetName' .
```
   Use `-w` for whole words. Search again for variants (camelCase, snake_case, strings in JSON/YAML/docs/tests).
2. **Find the test command.** Look in `SIXFINGER.md`, `package.json` scripts, `Makefile`, `pyproject.toml`. Run it NOW, before any change, with a timeout (`CI=1`, `< /dev/null`):
   - `CI=1 npm test < /dev/null`, `python3 -m pytest -q < /dev/null`, `npx tsc --noEmit`, `npm run build`.
   - Record the result (e.g. "31 passed, 0 failed"). If it already fails, tell the user and do not proceed blindly: note which tests fail before you touch anything.
3. **No tests for the target? Write characterization tests first.** Pin down current behavior, even if odd:
   - Call the function with 3-6 representative inputs (normal, empty, edge, error) and assert the CURRENT output.
   - Use the project's test framework and test folder. Put it in a new file next to existing tests. Run it; it must pass on the unchanged code.
   - If the code cannot be tested (needs network, DB, UI), use a script that prints outputs before/after and compare them with `diff`: `node script.js > /tmp/before.txt` ... `diff /tmp/before.txt /tmp/after.txt`.
4. **Plan with `todo`**: list each small step (one rename, one extraction, one file move). Exactly one in progress.
5. **Do one step. Then verify. Then the next.** After EVERY step run: the type check/build and the tests. If red, fix or revert that step by editing it back (you cannot use git to undo), then continue. Do not stack several unverified steps.
6. **Finish**: run the full test + build + lint again and compare with the result from step 2. Review the diff: `git diff --stat`, `git diff -U2 -- <file>`. Make sure no unrelated lines changed.

## Rename recipe
1. List every occurrence (step 1 grep). Count them.
2. Rename the definition, then each use with `edit`. For many occurrences in one file use `edit` with `replace_all: true`, but ONLY when the old text is unambiguous. Check the grep output first: `replace_all` also changes substrings (`user` inside `username`, `userId`), comments, strings and unrelated variables with the same name.
3. `sed -i` is allowed for a mass rename only with word boundaries and a reviewed file list:
```
grep -rlw --exclude-dir=node_modules --exclude-dir=.git 'oldName' src > /tmp/files.txt; cat /tmp/files.txt
xargs -a /tmp/files.txt sed -i 's/\boldName\b/newName/g'
```
   Never run `sed -i` on `.` or on lockfiles, minified files, binaries, `.git`, or `node_modules`. Do not use `sed` for multi-line changes.
4. Grep again: `oldName` must have 0 hits (except intentional ones like a deprecated alias for the public API). Also grep strings, docs and config.
5. Run type check/build + tests.
- Renames of exported items: keep the old name as a re-export (`export { newName as oldName }`) if other packages or users depend on it, and tell the user.

## Extract / split recipes
- **Extract function**: copy the block into a new function with explicit parameters and return value; call it at the old spot; do not change the logic inside. Watch variables the block mutates (they must become return values).
- **Split a big file**: move one cohesive group of functions at a time to a new file; update imports; keep the old file re-exporting moved names so imports elsewhere keep working. New files under ~300 lines.
- **Remove duplication**: only merge code that is truly the same. If copies differ in a small way, add a parameter; if they differ in behavior, leave them.
- **Simplify conditionals**: early returns, remove dead branches only after proving they are unreachable (grep callers, check tests).
- **Moving files**: `mv` the file (shell `mv` is fine), then fix every import path with grep for the old path.

## Do not
- Do not rewrite a module from scratch in one big `write`. Change it in steps.
- Do not rename and change logic in the same step.
- Do not touch generated files, vendored code, or lockfiles.
- Do not say "done" without the before/after test results.

## Verify (checklist)
- Tests/build/lint: same or better than step 2.
- `grep` for the old names: 0 hits (unless intentional).
- `git diff --stat`: only the files you meant to touch.
- Public API unchanged (or listed for the user).

## Final answer
Short: what was restructured (file paths), test/build result before and after, API changes (none, or the list), bugs noticed but NOT fixed, and what you could not verify.
