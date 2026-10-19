# Express 5 REST API scaffold (ESM, zod, SQLite): full files

Tested end to end (CRUD, validation, bad JSON, 404, static UI, better-sqlite3 and node:sqlite fallback). Create each file with `write`, adapt the resource name (`todos`) and columns.

## package.json
```json
{
  "name": "todo-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "express": "^5.1.0",
    "zod": "^4.0.0"
  }
}
```

## src/config.js
```js
export const config = {
  port: Number(process.env.PORT) || 3000,
  dbFile: process.env.DB_FILE || 'data/app.db',
  nodeEnv: process.env.NODE_ENV || 'development',
};
```

## src/db.js
```js
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// better-sqlite3 when installed, else built-in node:sqlite (Node 22.5+). Same prepare/run/get/all API.
let open;
try {
  const { default: Database } = await import('better-sqlite3');
  open = (f) => new Database(f);
} catch {
  const { DatabaseSync } = await import('node:sqlite');
  open = (f) => new DatabaseSync(f);
}

if (config.dbFile !== ':memory:') mkdirSync(dirname(config.dbFile), { recursive: true });
export const db = open(config.dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);
```

## src/middleware/errors.js
```js
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: { message: `Not found: ${req.method} ${req.originalUrl}` } });
}

// Express 5 forwards errors from async handlers here automatically.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { message: status >= 500 ? 'Internal server error' : err.message, details: err.details } });
}
```

## src/middleware/validate.js
```js
import { HttpError } from './errors.js';

// validate(schema) parses req.body with a zod schema and replaces it with the clean value.
export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new HttpError(400, 'Validation failed', details));
  }
  req.body = r.data;
  next();
};
```

## src/controllers/todos.js
```js
import { z } from 'zod';
import { db } from '../db.js';
import { HttpError } from '../middleware/errors.js';

export const createSchema = z.object({ title: z.string().trim().min(1, 'title is required').max(200) });
export const updateSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() });

const toDto = (r) => ({ id: r.id, title: r.title, done: !!r.done, createdAt: r.created_at });
const parseId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive integer');
  return id;
};
const find = (id) => {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, `Todo ${id} not found`);
  return row;
};

export const list = (req, res) => {
  const rows = db.prepare('SELECT * FROM todos ORDER BY id DESC').all();
  res.json(rows.map(toDto));
};

export const get = (req, res) => res.json(toDto(find(parseId(req.params.id))));

export const create = (req, res) => {
  const info = db.prepare('INSERT INTO todos (title) VALUES (?)').run(req.body.title);
  res.status(201).json(toDto(find(Number(info.lastInsertRowid))));
};

export const update = (req, res) => {
  const id = parseId(req.params.id);
  const cur = find(id);
  const title = req.body.title ?? cur.title;
  const done = req.body.done === undefined ? cur.done : req.body.done ? 1 : 0;
  db.prepare('UPDATE todos SET title = ?, done = ? WHERE id = ?').run(title, done, id);
  res.json(toDto(find(id)));
};

export const remove = (req, res) => {
  const id = parseId(req.params.id);
  find(id);
  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  res.status(204).end();
};
```

## src/routes/todos.js
```js
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import * as c from '../controllers/todos.js';

const router = Router();
router.get('/', c.list);
router.post('/', validate(c.createSchema), c.create);
router.get('/:id', c.get);
router.patch('/:id', validate(c.updateSchema), c.update);
router.delete('/:id', c.remove);
export default router;
```

## src/app.js
```js
import express from 'express';
import todos from './routes/todos.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  // Only needed when a frontend on ANOTHER origin calls this API (the preview is same-origin: skip it there).
  app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/todos', todos);
  app.use('/api', notFound); // unknown API paths -> JSON 404
  app.use(express.static('public')); // optional static UI
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

## src/server.js
```js
import { createApp } from './app.js';
import { config } from './config.js';

const server = createApp().listen(config.port, () => console.log(`API ready on port ${config.port}`));
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is busy. Start with PORT=<other> npm start` : e);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
```

## public/index.html
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Todos</title>
  <style>body{font-family:system-ui;max-width:32rem;margin:1rem auto;padding:0 1rem}li{padding:.4rem 0}.done{text-decoration:line-through;opacity:.6}input,button{font-size:1rem;padding:.5rem}</style>
</head>
<body>
  <h1>Todos</h1>
  <form id="f"><input id="t" placeholder="New todo" required> <button>Add</button></form>
  <ul id="list"></ul>
  <script>
    // RELATIVE urls (no leading slash): the page is served under a preview path prefix.
    const api = (path, opt) => fetch('api/todos' + path, opt).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error.message);
      return r.status === 204 ? null : r.json();
    });
    async function load() {
      const items = await api('');
      list.innerHTML = '';
      for (const t of items) {
        const li = document.createElement('li');
        li.textContent = t.title;
        li.className = t.done ? 'done' : '';
        li.onclick = async () => { await api('/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !t.done }) }); load(); };
        list.append(li);
      }
    }
    f.onsubmit = async (e) => {
      e.preventDefault();
      await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t.value }) });
      t.value = '';
      load();
    };
    load().catch((e) => alert(e.message));
  </script>
</body>
</html>
```

## .gitignore
```
node_modules/
data/
.env
```

## CommonJS variant (only when the project already uses `require`)
- `package.json` without `"type": "module"`; files use `const express = require('express')` and `module.exports = { ... }`.
- zod 4 and express 5 both support `require`.
- No top-level await: in `db.js` use
```js
let open;
try { const Database = require('better-sqlite3'); open = (f) => new Database(f); }
catch { const { DatabaseSync } = require('node:sqlite'); open = (f) => new DatabaseSync(f); }
```

## Express 4 differences (only when the project pins express@4)
- Async handlers do NOT forward rejected promises: wrap them: `const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);` and use `router.get('/', wrap(handler))`.
- Catch-all: `app.use('*', ...)` is fine in 4 but invalid in 5; prefer `app.use(notFound)` (works in both).
- `req.body` is `undefined` when no body was sent only in 5; in 4 it is `{}`. `req.body ?? {}` works in both.

## Manual validation (no zod, when install is blocked)
```js
export function validateTodo(body) {
  const errors = [];
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push({ field: 'title', message: 'title is required' });
  if (title.length > 200) errors.push({ field: 'title', message: 'max 200 characters' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  return { title };
}
```
Call it at the top of the controller: `const data = validateTodo(req.body);`.
