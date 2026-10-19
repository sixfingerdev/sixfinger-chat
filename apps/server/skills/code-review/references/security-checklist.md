# Security checklist for review

Go through only the items that match the changed code. `$B` is the base commit: `B="$(cat .git/sixfinger/base 2>/dev/null || echo HEAD)"`. For each hit, report `path:line`, the attack input, and the fix.

## Injection
- SQL built with string concatenation or template literals (`"... WHERE id = " + id`, `` `... ${name}` ``). Fix: parameterized query (`$1`, `?`).
- Shell: `exec(`, `execSync(`, `child_process.exec`, `os.system`, `subprocess.run(..., shell=True)`, backticks with user data. Fix: `execFile`/`spawn` with an argument array, `shell=False`.
- `eval`, `new Function`, `vm.runInContext`, `pickle.loads`, `yaml.load` (not `safe_load`) on external data.
- HTML: `innerHTML`, `outerHTML`, `document.write`, `dangerouslySetInnerHTML`, `v-html`, unescaped template output with user data. Fix: `textContent`, framework escaping, or a sanitizer.
- Path: `path.join(base, userInput)` / `open(userInput)` without checking the result stays inside `base` (`../`, absolute paths, symlinks).
- URL fetch with a user URL (SSRF): no allowlist for scheme/host, follows redirects to internal addresses.
- Regex built from user input (ReDoS / injection): escape it or limit the length.

## Authentication and authorization
- Route/handler without an auth check where sibling routes have one.
- Authorization only in the UI, not on the server.
- Object access by id without checking the owner (`WHERE id = $1` instead of `WHERE id = $1 AND user_id = $2`).
- Role or `isAdmin` taken from the request body/query.
- Token/JWT: no signature or expiry check, `alg: none` allowed, secret hard-coded.
- Password compare with `==`; passwords stored plain or with md5/sha1/sha256 (need bcrypt/argon2/scrypt).
- Missing CSRF protection on cookie-authenticated state-changing routes.
- CORS `*` together with credentials; reflecting any `Origin`.

## Secrets and data exposure
- API keys, tokens, passwords, private keys, connection strings in code, tests, fixtures, config, or `.env` committed. Run: `git diff "$B" | grep -nEi "(api[_-]?key|secret|token|passw(or)?d|private key|BEGIN [A-Z ]*PRIVATE)"` and read the hits.
- Secrets or personal data written to logs, error messages, or API responses.
- Stack traces or SQL errors returned to the client.
- `.env` / key files missing from `.gitignore`.

## Input validation
- Request body/query/params used without type, length, range checks.
- File upload without size limit, type check, or safe filename.
- Unbounded loops/pagination from user numbers (`limit=1e9`).
- Numeric parsing without NaN check; `parseInt` without radix on user data.

## Races and state (security impact)
- Check-then-act on a file or DB row without a lock/transaction (balance, stock, unique name). Fix: transaction, `UNIQUE` constraint, atomic update.
- Temp files with predictable names in a shared directory.

## Resource handling
- Files, sockets, DB connections, timers, listeners opened and not closed on the error path (no `finally` / `with` / `defer`).
- Unbounded caches or arrays that grow per request.
- Child processes without a timeout.

## Dependencies
- New dependency for a tiny task, unknown package name (typosquat), unpinned `latest`.
- Lockfile changed without a matching `package.json` change.
