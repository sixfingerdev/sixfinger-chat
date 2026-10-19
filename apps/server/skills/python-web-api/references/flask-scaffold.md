# Flask scaffold (Flask 3, sqlite3, vanilla JS UI): full files

Tested end to end (CRUD, validation, bad JSON, 404, templates, static files). Create each file with `write`; rename `notes` and the columns to the user's resource.

## requirements.txt
```text
flask>=3.0
```

## db.py
```python
import os
import sqlite3
from contextlib import contextmanager

DB_FILE = os.environ.get("DB_FILE", "data/app.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""


def connect():
    """One short-lived connection per request (sqlite3 connections are not shared across threads)."""
    if DB_FILE != ":memory:":
        os.makedirs(os.path.dirname(DB_FILE) or ".", exist_ok=True)
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


@contextmanager
def db():
    """Usage: `with db() as con:`. Commits on success, rolls back on error, always closes."""
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db():
    with db() as con:
        con.executescript(SCHEMA)
```

## app.py
```python
import os

from flask import Flask, jsonify, render_template, request

from db import db, init_db

app = Flask(__name__)
init_db()


def row_to_dict(r):
    return {"id": r["id"], "title": r["title"], "done": bool(r["done"]), "createdAt": r["created_at"]}


def error(status, message, details=None):
    body = {"error": {"message": message}}
    if details:
        body["error"]["details"] = details
    return jsonify(body), status


@app.errorhandler(404)
def not_found(e):
    return error(404, f"Not found: {request.method} {request.path}")


@app.errorhandler(405)
def bad_method(e):
    return error(405, "Method not allowed")


@app.errorhandler(Exception)
def unexpected(e):
    app.logger.exception(e)
    return error(500, "Internal server error")


def read_title(data, required):
    """Returns (title, problems). Validates by hand: no extra packages needed."""
    if "title" not in data:
        return None, ([{"field": "title", "message": "title is required"}] if required else [])
    t = data["title"]
    if not isinstance(t, str) or not t.strip():
        return None, [{"field": "title", "message": "title must be a non-empty string"}]
    if len(t.strip()) > 200:
        return None, [{"field": "title", "message": "max 200 characters"}]
    return t.strip(), []


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.get("/api/notes")
def list_notes():
    with db() as con:
        rows = con.execute("SELECT * FROM notes ORDER BY id DESC").fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.post("/api/notes")
def create_note():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error(400, "Body must be a JSON object")
    title, problems = read_title(data, required=True)
    if problems:
        return error(400, "Validation failed", problems)
    with db() as con:
        cur = con.execute("INSERT INTO notes (title) VALUES (?)", (title,))
        row = con.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.patch("/api/notes/<int:note_id>")
def update_note(note_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error(400, "Body must be a JSON object")
    title, problems = read_title(data, required=False)
    if "done" in data and not isinstance(data["done"], bool):
        problems.append({"field": "done", "message": "done must be true or false"})
    if problems:
        return error(400, "Validation failed", problems)
    with db() as con:
        cur = con.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        if cur is None:
            return error(404, f"Note {note_id} not found")
        con.execute(
            "UPDATE notes SET title = ?, done = ? WHERE id = ?",
            (title or cur["title"], int(data["done"]) if "done" in data else cur["done"], note_id),
        )
        row = con.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.delete("/api/notes/<int:note_id>")
def delete_note(note_id):
    with db() as con:
        deleted = con.execute("DELETE FROM notes WHERE id = ?", (note_id,)).rowcount
    if deleted == 0:
        return error(404, f"Note {note_id} not found")
    return "", 204


if __name__ == "__main__":
    # debug=False: the reloader starts a second process and the debugger exposes code execution.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
```

## templates/index.html
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notes</title>
  <link rel="stylesheet" href="static/style.css">
</head>
<body>
  <h1>Notes</h1>
  <form id="form"><input id="title" placeholder="New note" required> <button>Add</button></form>
  <ul id="list"></ul>
  <script src="static/app.js"></script>
</body>
</html>
```

## static/style.css
```css
body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 1rem auto; padding: 0 1rem; }
li { padding: .4rem 0; cursor: pointer; }
li.done { text-decoration: line-through; opacity: .6; }
input, button { font-size: 1rem; padding: .5rem; }
```

## static/app.js
```js
// RELATIVE urls only (no leading slash): the app is shown under a preview path prefix.
const json = { "Content-Type": "application/json" };

async function api(path, opt) {
  const r = await fetch("api/notes" + path, opt);
  if (!r.ok) throw new Error((await r.json()).error.message);
  return r.status === 204 ? null : r.json();
}

async function load() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  for (const n of await api("")) {
    const li = document.createElement("li");
    li.textContent = n.title;
    li.className = n.done ? "done" : "";
    li.onclick = async () => {
      await api("/" + n.id, { method: "PATCH", headers: json, body: JSON.stringify({ done: !n.done }) });
      load();
    };
    list.append(li);
  }
}

document.getElementById("form").onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById("title");
  await api("", { method: "POST", headers: json, body: JSON.stringify({ title: input.value }) });
  input.value = "";
  load();
};

load().catch((e) => alert(e.message));
```

## .gitignore
```
.venv/
__pycache__/
data/
.env
```

## Notes
- `app.run(..., debug=False)`: never `debug=True` (reloader = second process; debugger = remote code execution).
- Templates use RELATIVE urls (`static/app.js`, `fetch("api/notes")`). Do not use `url_for('static', ...)` or `redirect(url_for(...))`: they produce root-absolute paths that break under the preview prefix.
- Flask returns HTML error pages by default; the `errorhandler`s above force JSON.
- Methods: `@app.get/post/patch/delete` exist in Flask 2+.
- One connection per request via `with db() as con:`; never keep a global connection (threads).
