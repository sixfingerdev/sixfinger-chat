# Plan templates for `todo`

Write the list with the `todo` tool. One item `in_progress` at a time. Each item is a result you can check.

## Template (generic)
1. Skeleton: folders + entry file that runs and shows something. Check: runs / preview shows a page.
2. Core feature: the one thing the app exists for. Check: manual run with a real input.
3. Feature B: second feature (own item). Check: run it.
4. Feature C: third feature (own item). Check: run it.
5. Polish: errors, empty states, mobile / touch, styles. Check: bad input does not crash.
6. Verify end to end: syntax checks, tests, build, preview. Check: all commands exit 0.
7. Final report: how to run, what was verified, known gaps.

## Example A: browser game ("snake oyunu yap")
Requirements (MUST): grid board, snake moves, food grows snake, wall / self collision ends game, score. LATER: high score, speed levels, sound.
Layout: `index.html`, `style.css`, `game.js` (loop + state), `input.js` (keyboard + touch buttons).
1. Skeleton: `index.html` with canvas, `game.js` draws an empty grid.
2. Snake moves with the arrow keys on a timer.
3. Food + growth + score.
4. Game over + restart button.
5. Touch / on-screen arrow buttons, high score in `localStorage` (try/catch), polish.
6. `node --check game.js input.js`, preview, play a few moves.
7. Final report.

## Example B: REST API + small UI ("notes app with API")
Requirements (MUST): create / list / delete notes, data survives restart. LATER: search, tags.
Layout: `server.js` (routes), `store.js` (read / write `data.json`), `public/index.html`, `public/app.js`.
1. Skeleton: Express server (or `http` module if installs are blocked) answers `GET /health`.
2. `store.js` + `GET/POST /api/notes`. Check with `curl`.
3. `DELETE /api/notes/:id`. Check with `curl`.
4. UI lists and adds notes (`fetch("api/notes")`, relative URL).
5. Polish: validation, empty state, error message in the UI.
6. Verify: start with `background=true`, curl each route, preview the port.
7. Final report.

## Example C: add a feature to an existing repo ("add dark mode")
1. Explore: `grep` for theme / styles, read the entry component (use `task` if the repo is big).
2. Define the change: which files, which approach, matching existing style.
3. Implement the core toggle.
4. Persist the choice, apply on load.
5. Run the project's lint / test / build.
6. Final report with `path:line` references.
