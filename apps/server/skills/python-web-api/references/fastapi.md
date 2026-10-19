# FastAPI scaffold (single file, sqlite3)

Use only when the project already uses FastAPI or the user asks for it. Needs `fastapi` and `uvicorn` (check: `python3 -c 'import fastapi, uvicorn'`). Tested with uvicorn + curl. Validation errors come back as FastAPI's default `{"detail": [...]}` (422), unlike the Flask scaffold's 400.

## main.py
```python
import os
import sqlite3
from contextlib import closing

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_FILE = os.environ.get("DB_FILE", "data/app.db")
os.makedirs(os.path.dirname(DB_FILE) or ".", exist_ok=True)

app = FastAPI(title="Notes API")


def run(sql, params=(), one=False):
    with closing(sqlite3.connect(DB_FILE)) as con:
        con.row_factory = sqlite3.Row
        cur = con.execute(sql, params)
        rows = cur.fetchall()
        con.commit()
        return (rows[0] if rows else None) if one else rows, cur


run("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)")


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class NotePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None


def dto(r):
    return {"id": r["id"], "title": r["title"], "done": bool(r["done"])}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/notes")
def list_notes():
    return [dto(r) for r in run("SELECT * FROM notes ORDER BY id DESC")[0]]


@app.post("/api/notes", status_code=201)
def create_note(body: NoteIn):
    _, cur = run("INSERT INTO notes (title) VALUES (?)", (body.title.strip(),))
    return dto(run("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,), one=True)[0])


@app.patch("/api/notes/{note_id}")
def update_note(note_id: int, body: NotePatch):
    row = run("SELECT * FROM notes WHERE id = ?", (note_id,), one=True)[0]
    if row is None:
        raise HTTPException(404, f"Note {note_id} not found")
    run("UPDATE notes SET title = ?, done = ? WHERE id = ?",
        (body.title or row["title"], row["done"] if body.done is None else int(body.done), note_id))
    return dto(run("SELECT * FROM notes WHERE id = ?", (note_id,), one=True)[0])


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    if run("DELETE FROM notes WHERE id = ?", (note_id,))[1].rowcount == 0:
        raise HTTPException(404, f"Note {note_id} not found")


@app.get("/")
def index():
    return FileResponse("public/index.html")


app.mount("/", StaticFiles(directory="public"), name="public")  # keep LAST: it matches every path

# Run: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
```

## Run
```bash
PORT=8000 python3 -m uvicorn main:app --host 0.0.0.0 --port 8000     # bash background=true
curl -s localhost:8000/api/health
```
- Interactive docs exist at `/docs` (needs CDN access in the browser; do not rely on it in the preview).
- `app.mount("/", StaticFiles(...))` must be the LAST route registration.
- Use plain `def` handlers with blocking sqlite3 (FastAPI runs them in a threadpool); `async def` + blocking calls freezes the server.
