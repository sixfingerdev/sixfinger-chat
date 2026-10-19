---
name: python-web-api
description: Builds or extends a Python web app or JSON API with Flask (or FastAPI if the project already uses it, or the standard library when pip is blocked): routes, templates and static files, SQLite via sqlite3, background start, curl tests and preview. Use when the user asks for a Python backend, Flask/FastAPI app, REST API or small web site in Python. Do not use for Node.js servers or for data-analysis scripts.
triggers: [python, flask, fastapi, django, uvicorn, jinja, python api, python backend, python sunucu, web uygulaması, web app, rest api, api, endpoint, sqlite, sqlite3, backend, sunucu, pip, veritabanı, route, rota, template, şablon]
---

# Python web API (Flask first)

## When to use
- New Flask/FastAPI/stdlib web app or JSON API in Python; add routes, templates, SQLite persistence.
- Fix a Python server: port, import errors, 500s, JSON errors.

## When NOT to use
- Node/Express projects: use `node-express-api`.
- Analysis of CSV/Excel files: use `data-analysis-python`.
- Static page with no server logic: write HTML and `preview` the file.

## Workflow
1. `todo`: plan (resources, endpoints, tables, verify steps).
2. Inspect first: `glob **/*.py`, `read requirements.txt` / `pyproject.toml`, `grep -rn "Flask(\|FastAPI(" .`. Use the framework and layout the project already has. Do not switch frameworks.
3. Pick the stack (new project):
   - Check what is installed: `python3 -c "import flask; print(flask.__version__)"` (also `fastapi`, `uvicorn`).
   - Flask present or installable: Flask. See `skill {name: "python-web-api", file: "references/flask-scaffold.md"}` (full tested files).
   - FastAPI only if the project or the user wants it: `references/fastapi.md`.
   - Nothing installable (install blocked): standard-library server, `references/stdlib-server.md`. Tell the user why.
4. Install (needs network; `timeout_seconds: 300`). Try in this order, stop at the first that works:
   1. `python3 -m venv --system-site-packages .venv && .venv/bin/pip install -q -r requirements.txt` then run with `.venv/bin/python`.
   2. `python3 -m pip install --user -q flask`
   3. If the error says `externally-managed-environment`: `python3 -m pip install --user --break-system-packages -q flask`
   4. If blocked by network policy or all fail: do NOT retry; use the stdlib server and say so.
   Write `requirements.txt` (`flask>=3.0`) and `.gitignore` (`.venv/`, `__pycache__/`, `data/`).
5. Write files one by one (each < ~150 lines): `db.py`, `app.py`, `templates/index.html`, `static/app.js`, `static/style.css`.
6. Compile check: `python3 -m py_compile app.py db.py` (use `.venv/bin/python` if you made a venv).
7. Start in background: `bash` with `background=true`, command `PORT=5000 python3 app.py`. Then `job_output` once: expect `Running on`. Never run it in the foreground. After every code change `job_kill` the old job and start again (`debug=False`: no reloader).
8. Test with curl (see Verify). Fix and repeat.
9. `preview` the port (a page at `/`). For an API without a page, preview a readable GET route only if it helps; otherwise say it was tested with curl.
10. Final answer with the start command. Keep the server running.

## Rules
- Bind `host="0.0.0.0"`, read the port from `PORT` (default 5000). Never `debug=True`.
- Use SQLite through `sqlite3` only, `?` placeholders ALWAYS (never f-strings in SQL). One connection per request, closed after (`with db() as con:` helper in the scaffold). `PRAGMA foreign_keys = ON` per connection. DB file in `data/` (git-ignored). Create tables with `CREATE TABLE IF NOT EXISTS` at start-up.
- Validate JSON by hand: `request.get_json(silent=True)` returns `None` for bad JSON; check `isinstance(data, dict)`, types, lengths. Respond 400 with `{"error": {"message", "details": [{"field","message"}]}}`.
- Status codes: 200 read/update, 201 create, 204 delete (empty body), 400 bad input, 404 missing, 405 wrong method, 409 conflict (`sqlite3.IntegrityError`), 500 unexpected. Add JSON `errorhandler`s for 404/405/Exception so clients never get HTML error pages.
- Never put secrets in code; read from `os.environ`. Never print them.
- Never use Flask's `url_for('static')`, `redirect(...)` or absolute URLs in templates (see Preview).
- Long processes (`app.py`) are never run without `background=true`.
- Keep types simple: `int` URL converters (`<int:note_id>`) already return 404 for non-numbers.

## Preview rules (served under a path prefix)
- In templates, JS and CSS use RELATIVE URLs: `<script src="static/app.js">`, `<link href="static/style.css">`, `fetch("api/notes")`.
- NOT `/static/app.js` in `fetch`, NOT `http://localhost:5000/...`, NOT redirects to `/`.
- The page must not hard-code origin or port. No WebSocket/Server-Sent reload: the user refreshes.
- Wrap `localStorage` use in try/catch. Add the viewport meta tag; make the layout responsive.
- No CORS needed for the same-origin preview. If a separate frontend needs it: set `Access-Control-Allow-Origin` in an `@app.after_request` hook.

## Common errors
| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: flask` | Install step 4; if blocked use the stdlib server. If a venv exists, run with `.venv/bin/python`. |
| `Address already in use` | Old job alive: `job_kill`, or `PORT=5001`. |
| `ImportError: cannot import name` / circular import | Keep `db.py` free of imports from `app.py`. |
| `sqlite3.OperationalError: no such table` | `init_db()` not called at start-up, or `DB_FILE` differs between runs. |
| `sqlite3.ProgrammingError: Incorrect number of bindings` | A single param needs a tuple: `(title,)`. |
| `sqlite3.OperationalError: database is locked` | A connection was left open: always use `with db() as con:` (closes it). |
| `TypeError: Object of type X is not JSON serializable` | Convert rows to dicts (`row_to_dict`) and bools/dates to plain types. |
| `415 Unsupported Media Type` | Client forgot `-H 'Content-Type: application/json'`. |
| Template not found | Folder must be named `templates/` next to `app.py`. |
| Blank page in preview, 404 on JS | Absolute `/static/...` or `fetch("/api")` used; make them relative. |
| FastAPI blocks | Blocking sqlite3 inside `async def`: use plain `def`. |

## Verify (run all, read each output)
```bash
python3 -m py_compile app.py db.py
B=localhost:5000
curl -s $B/api/health
curl -s -i -X POST $B/api/notes -H 'Content-Type: application/json' -d '{"title":"Buy milk"}'   # 201
curl -s -X POST $B/api/notes -H 'Content-Type: application/json' -d '{"title":""}'               # 400 + details
curl -s -X POST $B/api/notes -H 'Content-Type: application/json' -d '{bad'                       # 400
curl -s $B/api/notes
curl -s -X PATCH $B/api/notes/1 -H 'Content-Type: application/json' -d '{"done":true}'
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $B/api/notes/1                                # 204
curl -s $B/api/notes/999                                                                          # 404 JSON
curl -s $B/ | head -n 5                                                                           # HTML page
```
- Test the happy path AND a failure for every route.
- Restart the server and list again: rows must persist.
- If the project has tests, run them: `python3 -m pytest -q` or `python3 -m unittest`.

## Final answer
Short: what was built, file paths, how to run (`pip install -r requirements.txt`, `PORT=5000 python3 app.py`), endpoint list (method + path), what curl verified, limits (dev server, no auth, SQLite file). If pip was blocked, say the stdlib server was used and why.
