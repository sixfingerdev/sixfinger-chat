---
name: project-planning
description: Process playbook for building a large app, game, tool or multi-file feature from scratch without losing track. Covers requirements, a staged todo plan, file layout, small working increments, verification after every stage, context discipline and the final report. Use when the request needs more than ~3 files or ~5 steps. Do not use for small edits or one-file fixes.
triggers: [uygulama yap, uygulama geliştir, sıfırdan, proje, baştan yaz, özellik ekle, sistem kur, web sitesi, oyun yap, panel, dashboard, yönetim paneli, build an app, from scratch, create a project, implement feature, full-stack, new feature, scaffold, plan, planla, mini uygulama, api yaz]
---

# Project planning for big builds

## When to use
- The task needs many files or many steps: a new app, a game, a CLI tool, an API, a multi-part feature.
- The request is vague and large ("make me a task manager", "bir muhasebe uygulaması yap").

## When NOT to use
- Small edit, one-file fix, a question, a single script. Just do it.
- Bug hunting: use the `debugging` skill. Tests only: use `write-tests`.

## Workflow

### 1. Requirements (do this in your head and in your first message, no file)
- Turn the request into 5-8 short requirement lines: what the user can do, what data exists, what the output looks like.
- Split them into MUST (core) and LATER (nice to have).
- If one answer would change the whole design (for example: web or CLI? which language?), call `ask_user` ONCE with concrete options. Ask at most one question in the whole task.
- Otherwise pick sensible defaults and state them in one line: "Assumptions: vanilla JS single page, data kept in localStorage."
- If the repo already has code, first look: `glob`, `grep`, read README / SIXFINGER.md / AGENTS.md / package.json. Follow its stack and style. Never switch the stack.

### 2. Choose the stack (small and light)
- Static web app or game: `index.html` + `style.css` + `app.js` (ES modules), no build step. CDN libraries are fine.
- Needs a server: Node + Express (or the built-in `node:http`), or Python stdlib `http.server`. Keep dependencies few.
- Need a bundler: Vite with `base: './'`. Do not use Next.js or Angular (disk and RAM are small).
- Check the network before installing anything (see system prompt). If install fails or is blocked, stop installing: switch to no-dependency code or tell the user.

### 3. Write the plan into `todo` (NOT into a PLAN.md file)
- Call `todo` with 5-9 items in these stages. Exactly one item `in_progress`.
  1. Skeleton: folders, entry file, minimal page / main that runs.
  2. Core feature (the one thing the app exists for).
  3. Second features (each its own item).
  4. Polish: errors, empty states, mobile / touch, styles.
  5. Verify: run everything end to end.
  6. Final report.
- Name each item as a result, not an activity: "Todo list renders and adds items", not "work on UI".
- A plan template and examples: read with `skill {name: "project-planning", file: "references/plan-template.md"}`.

### 4. Decide the file layout BEFORE coding
- Write the folder tree in one sentence or short list in your message, then create the files in stage 1.
- One responsibility per file. Keep every file under ~400 lines; if one grows past that, split it (`data.js`, `render.js`, `input.js`).
- Do not write one giant file in a single `write` call. Write the skeleton, then add parts with `edit` or new files.
- No placeholders: never write `// TODO`, `...`, "rest of the code here" in a file.

### 5. Build in small working increments
- Smallest running version first. After every stage the project must run, even if features are missing.
- Per stage: write files with `write` / `edit` (code in your text reply is NOT saved), then verify (step 6), then mark the todo item completed, then start the next.
- One stage = a few files, not the whole app. If a stage takes more than ~6 tool calls, split it into two todo items.
- Do not start polish before the core works. Do not add features the user did not ask for.

### 6. Verify at the end of EVERY stage
Pick what fits; run it, read the output:
- JS syntax: `node --check file.js` (for each new .js file).
- Python: `python3 -m py_compile file.py`.
- Project scripts: `npm run build`, `npm test` (use `CI=1`, never watch mode).
- Server: `bash` with `background=true`, then `job_output` to see it started, then `curl -s localhost:PORT/ | head -c 500`.
- Web page or game: call `preview {path: "index.html"}` once the core works, and again at the end.
- A failing check = fix it now, before the next stage. Never stack new code on a broken base.
- Never say "should work". Say what you ran and what it printed.

### 7. Context discipline (long tasks)
- Trim command output: `| head -n 40`, `| tail -n 30`, `grep -c`. Never `cat` big files or lockfiles.
- Read a file once; after you write or edit it you know its contents. Re-read only before an `edit` if it changed or the conversation was compacted.
- Independent reads / greps go in one turn together.
- Heavy research (how does library X work, where is Y in a big repo, compare options) goes to the `task` sub-agent with a self-contained prompt. You do the editing.
- Keep the todo list current: it is your memory after compaction. Re-check it before choosing the next step.
- Do not repeat a failing command unchanged. After 3 failures of the same approach, change approach (see the `debugging` skill).

### 8. When to stop and report to the user
- Stop and say so when: installs are blocked and no fallback exists; the requirement is impossible as stated; you need a secret / API key; a decision would change the whole design.
- Do not stop just to say "stage 2 done". Keep going until the MUST list is done and verified.
- If you ran out of room (very large request), finish the current stage in a working state, list what remains in the final answer, and let the user continue.

### 9. Finish
1. Run the quality checklist: `skill {name: "project-planning", file: "references/quality-checklist.md"}`.
2. Mark all todos completed.
3. For anything viewable, `preview` it one last time. For a file deliverable (zip, export), `share_file`.

## Rules
- Do not create `PLAN.md`, `NOTES.md`, `TODO.md` or other planning files. The plan lives in `todo`.
- Do not create a README unless the user asked or the project is meant to be run by others; a short "how to run" in the final answer is enough.
- Do not run git commit / push / branch. The platform commits.
- No interactive commands: use `--yes`, `-y`, `CI=1`, `< /dev/null`. Long installs: `timeout_seconds` 600+ or `background=true`.
- Previews: relative URLs only (`app.js`, `fetch("data.json")`), wrap `localStorage` in try/catch. Add touch / on-screen buttons next to keyboard controls and a `viewport` meta tag.

## Final answer
Short, in the user's language:
- What was built (1-2 lines) and the key files (`path`).
- How to run it (exact command or "open the preview").
- What you ran to verify and the result.
- Assumptions you made and known gaps / next steps (honest, one line each).
