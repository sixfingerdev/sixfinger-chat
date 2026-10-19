# Quality checklist (run before the final answer)

Tick each by running something, not by feeling.

## Works
- [ ] Every new `.js` passes `node --check <file>`; every `.py` passes `python3 -m py_compile <file>`.
- [ ] The project's own build / test / lint commands pass (`npm run build`, `CI=1 npm test`).
- [ ] The main flow was run with a real input and the output was read.
- [ ] Servers: started in background, `curl` returned the expected body, `job_output` shows no errors.
- [ ] Viewable result: `preview` was called after the last change.

## Complete
- [ ] Every MUST requirement is done. Nothing in the files says `TODO`, `...`, `lorem`, `placeholder`.
  Check: `grep -rnE "TODO|FIXME|\.\.\.$|placeholder" --include=*.js --include=*.html --include=*.css --include=*.py . | grep -v node_modules | head -n 20`
- [ ] Empty state, invalid input and failure paths do not crash (empty list, empty form, network error).
- [ ] No leftover debug output (`console.log` spam), no secrets in files.

## Web / game specific
- [ ] All asset and fetch URLs are relative.
- [ ] `localStorage` use is inside try/catch.
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1">` is present.
- [ ] Touch / on-screen controls exist next to keyboard controls; layout works at ~360px width.

## Structure
- [ ] No file over ~400 lines (`wc -l` on the source files).
- [ ] No planning files (`PLAN.md`, `NOTES.md`) were created.
- [ ] Only files that belong to the task changed (`git status --short`).

## Report
- [ ] The final answer lists: what was built, how to run, what was verified, assumptions, known gaps.
