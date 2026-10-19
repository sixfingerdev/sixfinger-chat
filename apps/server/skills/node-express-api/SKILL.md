---
name: node-express-api
description: Builds or extends a Node.js REST API with Express (routes, controllers, JSON validation, error middleware, env config, SQLite persistence), starts it in the background, tests every endpoint with curl and shows it with preview. Use when the user asks for a backend, API, server, endpoints, CRUD or database in Node.js. Do not use for a purely static page or for Python backends.
triggers: [api, rest api, express, node, nodejs, node.js, backend, sunucu, endpoint, uç nokta, crud, veritabanı, sqlite, middleware, route, rota, json api, web servisi, npm start, server]
---

# Node.js REST API (Express)

## When to use
- Create a new REST/JSON API, or add routes, validation, persistence or middleware to an existing Express app.
- Fix API bugs: port in use, CORS, unhandled async errors, wrong status codes.

## When NOT to use
- Static pages or games with no server: write HTML/JS and `preview` the file.
- Python projects: use the `python-web-api` skill.

## Workflow
1. `todo`: write the plan (resources, endpoints, tables, verify steps).
2. Inspect the project first: `read package.json`, `glob src/**/*.js`. Follow what exists: ESM (`"type": "module"`) or CommonJS, Express version, folder layout, test runner, existing DB. Add to it; do not restructure it.
3. New project: create the files from `references/scaffold.md` (read it with `skill {name: "node-express-api", file: "references/scaffold.md"}`). It has the complete, tested layout: `src/{server,app,config,db}.js`, `src/routes/`, `src/controllers/`, `src/middleware/{validate,errors}.js`, `public/index.html`. Rename `todos` to the user's resource and change the columns. Write files one by one (each under ~150 lines).
4. Install (needs network; `timeout_seconds: 600`):
   `npm install express zod better-sqlite3 --no-audit --no-fund`
   - If the install is blocked or fails: STOP retrying. Drop `better-sqlite3` (Node 22.5+ has built-in `node:sqlite`; `src/db.js` already falls back to it) and drop `zod` (use manual validation from the reference). If Express itself cannot be installed, tell the user; do not fake it.
   - Check `node --version`: `node:sqlite` needs 22.5+. On older Node, `better-sqlite3` must install.
5. Syntax check: `for f in $(find src -name '*.js'); do node --check $f || break; done`.
6. Start in background: `bash` with `background=true`, command `PORT=3000 node src/server.js`. Then `job_output` once: expect `API ready on port 3000`. Never start the server in the foreground (it blocks forever). Never poll in a loop.
7. Test every endpoint with curl (see Verify). Fix and restart (`job_kill` the old job first) after each code change; Express does not reload by itself.
8. Show it: if the API serves a UI from `public/`, call `preview` with the port. With no UI, `preview` the port only if a GET route returns something readable (e.g. `/api/todos`) and say the rest was tested with curl.
9. Final answer: include the start command. Keep the server running; do not kill it.

## Structure rules
- `app.js` builds the app (`createApp()`, no `listen`); `server.js` only calls `listen`. This keeps the app testable.
- Routes only map URL + method to a controller and attach `validate(schema)`. Controllers hold the logic and DB calls. Middleware in `src/middleware/`.
- Config comes from `process.env` in one `config.js` with defaults: `PORT`, `DB_FILE`, `NODE_ENV`. Never hard-code a port other than as a default. Never commit secrets; read them from env and document them in the README.
- Mount the API under `/api/...`. Unknown `/api/*` paths return JSON 404, not HTML.
- Status codes: 200 read/update, 201 create (return the created object), 204 delete (empty body), 400 validation/bad id/bad JSON, 404 missing row, 409 conflict (unique violation), 500 unexpected.
- Error body shape is always `{"error": {"message": "...", "details": [...]}}`. Never send stack traces.
- Express 5 (current default from npm): rejected promises in async handlers reach the error middleware automatically. Express 4: wrap async handlers (see reference). Check with `node -p "require('express/package.json').version"`.
- Express 5 path syntax: no bare `*`; use `/*splat` or a final `app.use(handler)`.

## Validation
- Validate `req.body` with a zod schema in middleware (`validate(schema)`), and `req.params.id` / `req.query` by hand (`Number.isInteger`). `req.body` is `undefined` when no JSON was sent: use `req.body ?? {}`.
- Respond 400 with `details: [{field, message}]`.
- Do not trust types: `done` may arrive as `"true"`; the schema decides what is accepted.

## SQLite
- Use `better-sqlite3` (sync API) or `node:sqlite` (`DatabaseSync`): both support `db.prepare(sql).run/get/all(...params)` and `db.exec(sql)`.
- Parameters ALWAYS through `?` placeholders. Never build SQL by string concatenation.
- Create tables with `CREATE TABLE IF NOT EXISTS` at start-up in `db.js`. Store the DB file under `data/` and add `data/` to `.gitignore`.
- `run()` returns `{changes, lastInsertRowid}` (`lastInsertRowid` may be a bigint: wrap in `Number()`).
- Booleans are stored as 0/1; convert in a `toDto` mapper. Dates: `datetime('now')` text.
- Unique violation: catch `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` (better-sqlite3) or message containing `UNIQUE constraint failed` (node:sqlite) and throw `HttpError(409, ...)`.
- Tests and demos with seed data: seed in a separate `src/seed.js` run once by hand, not on every start.

## Preview of a static UI served by Express
- Serve it with `app.use(express.static('public'))` AFTER the API routes.
- The preview lives under a path prefix. In `public/index.html` use RELATIVE URLs: `fetch('api/todos')`, `<script src="app.js">`, `<link href="style.css">`. NOT `fetch('/api/todos')` and NOT `http://localhost:3000/...`.
- No CORS headers are needed for the same-origin preview. Add the CORS middleware (in the scaffold) only when a frontend on another origin calls the API.
- Wrap `localStorage` in try/catch. Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.

## Common errors
| Symptom | Fix |
|---|---|
| `EADDRINUSE` | An old job still runs. `job_kill` it, or start with another `PORT=3001`. Then preview the new port. |
| `Cannot find package 'x'` | Not installed: `npm install x`. In ESM, relative imports need the `.js` extension. |
| `require is not defined` / `Cannot use import statement` | ESM/CJS mismatch: check `"type"` in package.json; match the project. |
| `curl: (7) Failed to connect` | Server not ready or crashed: `job_output`. |
| Request hangs | Handler never calls `res.json()`/`next()`. |
| CORS error in browser | Same-origin preview: use relative URLs. Otherwise add the CORS middleware. |
| `req.body` undefined / empty | Missing `express.json()`, or client forgot `Content-Type: application/json`. |
| Async error crashes the process | Express 4: wrap handler. Any version: `process.on('unhandledRejection', ...)` only logs; fix the cause. |
| `Unexpected token` JSON from curl | Quote the body with single quotes: `-d '{"title":"x"}'`. |
| `better-sqlite3` build error | Use `node:sqlite` (Node 22.5+) via the fallback in `db.js`. |

## Verify (run all, read each output)
```bash
B=http://localhost:3000
curl -s $B/api/health
curl -s -i -X POST $B/api/todos -H 'Content-Type: application/json' -d '{"title":"Buy milk"}'   # 201
curl -s -X POST $B/api/todos -H 'Content-Type: application/json' -d '{"title":""}'               # 400 + details
curl -s -X POST $B/api/todos -H 'Content-Type: application/json' -d '{bad'                       # 400 Invalid JSON
curl -s $B/api/todos                                                                              # list
curl -s -X PATCH $B/api/todos/1 -H 'Content-Type: application/json' -d '{"done":true}'
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $B/api/todos/1                                # 204
curl -s $B/api/todos/999                                                                          # 404 JSON
```
- Every route: happy path AND one failure (bad body, missing id). Compare status codes with the table above.
- Restart the server and `GET` the list again: data must survive (SQLite persistence).
- If the project has tests (`npm test`), run them.

## Final answer
Short: what was built, file paths, how to run (`npm install`, `PORT=3000 npm start`), the endpoint list (method + path), env vars, what was verified by curl, known limits (no auth, single process, SQLite file). Do not paste whole files.
