# Standard-library server (no pip needed)

Use when `pip install flask` is blocked. Serves JSON under `/api/notes` and static files from `public/`. Tested with curl. PATCH/PUT return 405 until you add a branch for them (copy the DELETE branch and read the body with `self.read_json()`).

## server.py
```python
"""Dependency-free JSON API + static files (python3 server.py). Use when pip installs are blocked."""
import json
import os
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB_FILE = os.environ.get("DB_FILE", "data/app.db")
PUBLIC = Path("public").resolve()
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml"}


def connect():
    os.makedirs(os.path.dirname(DB_FILE) or ".", exist_ok=True)
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    return con


with connect() as _c:
    _c.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)")


def dto(r):
    return {"id": r["id"], "title": r["title"], "done": bool(r["done"])}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def err(self, status, message):
        self.send_json(status, {"error": {"message": message}})

    def read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
            return data if isinstance(data, dict) else None
        except ValueError:
            return None

    def route(self):
        path = self.path.split("?")[0]
        m = re.fullmatch(r"/api/notes(?:/(\d+))?", path)
        if path == "/api/health":
            return self.send_json(200, {"ok": True})
        if not m:
            if path.startswith("/api/") or self.command != "GET":
                return self.err(404, f"Not found: {self.command} {path}")
            return self.static(path)
        note_id = int(m.group(1)) if m.group(1) else None
        with connect() as con:
            if note_id is None and self.command == "GET":
                return self.send_json(200, [dto(r) for r in con.execute("SELECT * FROM notes ORDER BY id DESC")])
            if note_id is None and self.command == "POST":
                data = self.read_json()
                title = data.get("title") if data else None
                if not isinstance(title, str) or not title.strip():
                    return self.err(400, "title must be a non-empty string")
                cur = con.execute("INSERT INTO notes (title) VALUES (?)", (title.strip(),))
                return self.send_json(201, dto(con.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()))
            if note_id is not None:
                row = con.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
                if row is None:
                    return self.err(404, f"Note {note_id} not found")
                if self.command == "GET":
                    return self.send_json(200, dto(row))
                if self.command == "DELETE":
                    con.execute("DELETE FROM notes WHERE id = ?", (note_id,))
                    return self.send_json(204)
        self.err(405, "Method not allowed")

    def static(self, path):
        f = (PUBLIC / path.lstrip("/")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if PUBLIC not in f.parents or not f.is_file():  # blocks ../ escapes
            return self.err(404, "Not found")
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_one(self):
        try:
            self.route()
        except Exception as e:  # never leak a traceback to the client
            self.log_error("error: %r", e)
            self.err(500, "Internal server error")

    do_GET = do_POST = do_DELETE = do_PATCH = do_PUT = handle_one


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Listening on port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
```

## Run
```bash
PORT=5000 python3 server.py        # bash background=true
curl -s localhost:5000/api/health
```
