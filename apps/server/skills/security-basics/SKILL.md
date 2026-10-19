---
name: security-basics
description: Basic security rules when writing or checking code - input validation, SQL injection, XSS, command injection, path traversal, secrets, auth, CORS, password storage, dependencies, safe defaults. Use when code handles user input, a database, files, shell commands, logins, passwords, tokens or API keys, or when the user asks for a security check. Do not use for general code review.
triggers: [güvenlik, güvenli, security, secure, zafiyet, vulnerability, enjeksiyon, injection, sql injection, xss, csrf, cors, parola, şifre, password, secret, api key, token, login, giriş, kimlik doğrulama, authentication, yetkilendirme, bcrypt, npm audit, sanitize]
---

# Security basics

Use while writing code that touches untrusted data, and as a checklist when reviewing. Fix the root cause, not the symptom.

## When to use
- Code reads user input (forms, query, body, files, CLI args, URLs, env).
- Code uses a database, shell, filesystem paths, HTML rendering, login, passwords, tokens, API keys, CORS, uploads.
- User asks "güvenli mi?", "security check", "açık var mı?".

## When NOT to use
- Pure refactor or docs with no input handling: not needed.
- Review of a diff in general: use `code-review` (it links to a security list).

## Core rules
1. **Never trust input.** Validate type, length, range and allowed values on the server, even if the UI checks too. Reject early; return a short error, not internals.
2. **Allowlists over blocklists.** Accept known-good values (enum, regex `^[a-z0-9_-]{1,64}$`), not "remove bad characters".
3. **Least privilege.** Only the access the feature needs.
4. **Secure by default.** Safe settings unless the user opts out.
5. **Fail closed.** On error, deny; do not continue as if the check passed.

## SQL injection
- Always use parameterized queries. Never build SQL with `+`, template strings, or f-strings.
```js
// Node (pg):    await db.query('SELECT * FROM users WHERE email = $1', [email]);
// sqlite3/mysql: db.get('SELECT * FROM users WHERE id = ?', [id]);
```
```python
cur.execute("SELECT * FROM users WHERE email = ?", (email,))   # sqlite3
```
- Table/column names cannot be parameters: choose from a fixed allowlist in code.
- With an ORM, use its query builder; avoid raw string queries.

## XSS (HTML output)
- Insert text with `element.textContent = value`, not `innerHTML`.
- Build DOM with `createElement`/`textContent`/`setAttribute`. No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` with data you did not write yourself.
- If HTML from users is required, sanitize with a maintained library (DOMPurify) — do not write your own.
- Server templates: use auto-escaping (Jinja2 autoescape on, EJS `<%= %>` not `<%- %>`, React default). Never mark user data as safe/raw.
- Never put user data in `href`/`src` without checking the scheme is `http:`/`https:` (block `javascript:`).
- For the sandbox preview: a page with its own `innerHTML` of user-typed text is still XSS. Use `textContent`.

## Command injection
- Do not build a shell string from input. Pass an argument array, no shell:
```js
import { execFile } from 'node:child_process';
execFile('convert', [inputPath, outputPath], cb);      // not exec(`convert ${inputPath} ...`)
```
```python
subprocess.run(["ls", "-l", path], check=True)          # shell=False (default); never shell=True with input
```
- Put `--` before user-supplied file names so they are not read as options: `["grep", "--", pattern, file]`.
- Never `eval`, `new Function`, `exec` on user text.

## Path traversal
- Resolve and check the path stays inside the base folder:
```js
const full = path.resolve(base, name);
if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error('bad path');
```
```python
full = (base / name).resolve()
if base.resolve() not in full.parents: raise ValueError("bad path")
```
- Generate stored file names yourself (uuid); never use the uploaded name. Limit upload size and allowed types.

## Secrets
- Never put API keys, tokens, passwords or private keys in code, tests, docs or logs. Read them from environment variables: `process.env.API_KEY`, `os.environ["API_KEY"]`.
- Keep local values in `.env`; add `.env` (and key files) to `.gitignore` BEFORE creating the file. Commit `.env.example` with fake placeholder values.
- Check before finishing: `grep -rnEi "(api[_-]?key|secret|passw(or)?d|token)\s*[:=]\s*['\"][^'\"]{8,}" --exclude-dir=node_modules --exclude-dir=.git .` and read hits.
- If a real secret was already committed, tell the user to rotate it; removing it from the file is not enough.
- Never print secrets in tool output, errors, or the final answer.
- Frontend code is public: a key in browser JS is not a secret. Proxy through a server.

## Authentication and authorization
- Check identity AND permission on the server for every protected route. Check object ownership (`WHERE id = ? AND user_id = ?`).
- Do not take role/user id from the request body. Take it from the verified session/token.
- Sessions: cookie with `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`). Random, long session ids from a crypto source.
- Tokens (JWT): verify signature and expiry with a library; fixed algorithm; secret from env; short lifetime.
- Add rate limiting on login and expensive routes.
- Same error for "user not found" and "wrong password".
- Cookie-authenticated POST/PUT/DELETE: CSRF token or `SameSite` + origin check.

## CORS
- Allow specific origins: `origin: ['https://app.example.com']`. Not `*` with credentials; do not reflect the request `Origin` blindly.
- CORS is a browser rule, not authentication; the server must still authenticate.

## Passwords
- Hash with bcrypt, argon2 or scrypt (salted, slow). NEVER store plain text, and never use md5/sha1/sha256 alone.
```js
import bcrypt from 'bcryptjs';                       // pure JS, no native build
const hash = await bcrypt.hash(password, 12);
const ok = await bcrypt.compare(password, hash);
```
```python
import hashlib, os
salt = os.urandom(16)
hash = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)   # stdlib, no install
```
- Compare secrets in constant time (`crypto.timingSafeEqual`, `hmac.compare_digest`).
- Use `crypto.randomBytes` / `secrets.token_urlsafe` for tokens, not `Math.random`.
- Never log passwords or tokens.

## Dependencies
- Add few dependencies; check names for typos; pin versions through the lockfile.
- `npm audit` needs network. Run `npm audit --omit=dev < /dev/null`; if the network is blocked, say "audit could not run". Python: `pip install pip-audit && pip-audit` (network).
- Do not run install scripts from unknown packages.
- Do not auto-apply `npm audit fix --force` (breaking upgrades): report instead.

## Safe defaults for servers
- Bind to `127.0.0.1` for dev servers unless exposure is needed.
- Limit request body size (`express.json({ limit: '100kb' })`).
- Do not return stack traces or SQL errors to clients; log them server-side without secrets.
- Set security headers (`helmet` for Express) when serving real traffic.
- Use HTTPS for anything beyond local development.
- Debug flags off by default.

## Review checklist
Run through when checking code. Report as `path:line — issue — fix`.
- [ ] Every input is validated server-side
- [ ] SQL parameterized; no string-built queries
- [ ] No `innerHTML`/`eval`/`document.write` with data
- [ ] No shell string with input; args array used
- [ ] File paths confined to a base folder
- [ ] No secrets in code/logs/tests; `.env` ignored
- [ ] Auth + ownership check on each protected route
- [ ] Passwords hashed with bcrypt/argon2/scrypt
- [ ] CORS limited; cookies HttpOnly/Secure/SameSite
- [ ] Errors do not leak internals
- [ ] Dependencies reviewed; audit run or "could not run" stated

For a longer review list: `skill {name: "code-review", file: "references/security-checklist.md"}`.

## Do not
- Do not "sanitize" with ad-hoc `replace("<","")`; use escaping or a library.
- Do not disable TLS verification or security checks to make something work.
- Do not claim the code is "secure". Say what you checked and what you did not.
- Do not add security libraries without checking what the project already uses.

## Final answer
List the risks found and fixed (`path:line`), what you checked, what you could not check (audit offline, no auth tests), and any secret the user must rotate.
