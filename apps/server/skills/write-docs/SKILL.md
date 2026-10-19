---
name: write-docs
description: Write or improve README files, project docs and SIXFINGER.md (the agent guide for a repository) from the real code, with every command verified by running it. Use when the user asks for a README, documentation, install/usage instructions, or a SIXFINGER.md/AGENTS.md. Do not use for code comments only or for marketing copy.
triggers: [readme, belge, dokümantasyon, doküman, döküman, belgele, documentation, docs, document, sixfinger.md, agents.md, kurulum kılavuzu, kullanım kılavuzu, docstring, açıklama yaz, anlat]
---

# Write docs

Docs must match the code. Read first, run every command, invent nothing.

## When to use
- "README yaz / güncelle", "projeyi belgele", "kurulum talimatı ekle", "SIXFINGER.md oluştur", "docs'u düzelt".

## When NOT to use
- Only inline code comments or docstrings in one function: just edit that function.
- Long marketing text, blog posts: not this skill.

## Workflow
1. **Read the project** (use `task` for a big repo, then verify key facts yourself):
   - `ls -1A`, existing `README.md`, `SIXFINGER.md` / `AGENTS.md` / `CLAUDE.md`, `docs/`.
   - Manifest: `package.json` (scripts, engines, bin, main), `pyproject.toml`/`requirements.txt`, `Makefile`, `Dockerfile`, `go.mod`, `Cargo.toml`.
   - Entry points, main folders, config/env vars (`grep -rnE "process\.env\.|os\.environ|getenv" . --exclude-dir=node_modules --exclude-dir=.git | head -n 40`).
   - Tests and CI: `ls .github/workflows`, test folder names.
2. **Plan with `todo`**: sections to write, commands to verify.
3. **Verify every command you will document** by running it in `bash` (`CI=1`, `< /dev/null`, `timeout_seconds` generous for installs; servers with `background=true`, check `job_output`, then stop them):
   - install (`npm install` / `pip install -r requirements.txt`), build, test, lint, start.
   - If the network blocks install: say so. Document the command as "not verified here" or leave it out. Never present an unrun command as verified.
   - If a command fails because the project is broken, tell the user; do not hide it in the docs.
4. **Write the file** with `write` (new) or `edit` (existing: keep the user's good content and tone, change only what is wrong or missing). Keep each file under ~300 lines.
5. **Re-check**: every path, script name and env var in the text exists (`ls`, `grep`). Every code block is copy-paste runnable.
6. Show result: `preview` is not needed for Markdown. If the user wants a downloadable file, call `share_file`.

## README skeleton
Use only sections that apply. Short sentences.
```
# <Project name>
<One sentence: what it does and for whom.>

## Features            (3-6 bullets, only real ones)
## Requirements        (runtime versions: from `engines`, `.nvmrc`, `pyproject`)
## Installation        (exact commands)
## Usage               (the most common command + a minimal example with real output or a realistic one marked "example")
## Configuration       (table: env var | default | meaning)
## Development         (clone, install, run dev, build)
## Testing             (exact test command, how to run one test)
## Project structure   (tree of main folders, one line each)
## License             (only if a LICENSE file exists)
```
- Do not add badges, roadmaps, contributors, or FAQs the repo does not support.
- Do not copy the full source into the README.

## SIXFINGER.md (agent guide for the repo)
Read by coding agents at the start of each task. Hard limit: 120 lines. Plain Markdown, commands in code blocks.
```
# <Project> — agent guide
## What this is        (2-3 lines: purpose, stack)
## Layout              (main directories, one line each; where tests live)
## Commands            (VERIFIED: install, build, test (all + single), lint/format, run)
## Conventions         (language/version, style, naming, error handling, imports, commit/PR habits)
## Gotchas             (things that break: generated files, env vars needed, slow tests, order of builds, ports)
## Do not              (files not to edit, things not to run)
```
- Only facts you verified. Mark unverified commands: `# not verified (needs network)`.
- Write rules as short commands ("Use pnpm, not npm."). No long explanations.
- Do not repeat what the code makes obvious. Do not paste secrets or tokens.
- If `AGENTS.md` or `CLAUDE.md` already exists, update it or tell the user instead of creating a conflicting copy.

## Improving an existing README
1. Read it fully. Run its commands: list which ones fail or are outdated.
2. Fix wrong facts first (commands, versions, paths), then fill missing sections, then trim fluff.
3. Keep headings the user already has unless they are wrong.

## Style
- Short, factual, present tense. Imperative for steps ("Run `npm test`").
- Language: match the existing docs; for a new file use the user's language, but keep commands and code in English.
- One fact in one place. Link to other files instead of copying.
- Name versions only if you read them from the repo.

## Do not
- Do not invent features, flags, endpoints, or env vars. If you cannot find it in the code, leave it out.
- Do not write placeholder text ("TODO", "...", "<your-key-here>" for things that are not secrets).
- Do not claim "tested" for commands you did not run.
- Do not rewrite the whole README when asked to fix one section.

## Keeping docs current
- When you change a command, flag, env var, or folder, grep the docs for it: `grep -rn "oldName" README.md docs SIXFINGER.md`, and update them in the same task.

## Verify
- Each documented command was run (or marked unverified) and the output matched.
- Links and relative paths exist: `ls <path>`.
- `wc -l SIXFINGER.md` is 120 or less.

## Final answer
List the files written/changed, which commands you verified (and which you could not, with the reason), and anything in the code that looked broken or undocumented.
