---
name: vite-react-app
description: Create or extend a Vite + React (TypeScript) single-page app, build it and show the production build with preview. Use when the user asks for a React app, a Vite project, a TypeScript front-end, a dashboard or an interactive multi-component web app. Do not use for simple pages or games without a framework (use static-web-app) or mobile apps (use expo-react-native).
triggers: [react, vite, typescript, tsx, jsx, bileşen, component, frontend, front-end, web uygulaması, web app, dashboard, panel, kontrol paneli, spa, todo uygulaması, yapılacaklar, hook, usestate, arayüz uygulaması, npm, tek sayfa uygulama]
---

# Vite + React + TypeScript app

## When to use
- User wants React, Vite, TypeScript, components, or a stateful app (dashboard, todo, form wizard, tool).
- The repo already has a Vite/React project: extend it (skip scaffolding, go to step 4).

## When NOT to use
- A game or page that needs no framework: load `static-web-app` (faster, no install).
- Next.js / Angular: too heavy for this sandbox. Use Vite and say so.
- Styling-only request: load `frontend-design`.

## Workflow
1. Plan with `todo`: scaffold, install, components, state, styling, build, preview.
2. Check the environment first (one command):
   ```bash
   node -v && npm -v && ls && df -h . | tail -1
   ```
3. Scaffold non-interactively in a NEW folder (never inside a non-empty folder; never run a command that prompts):
   ```bash
   CI=1 npm create vite@latest <app-name> -- --template react-ts < /dev/null
   ```
   - Use a lowercase-with-dashes name. Variants: `react` (JavaScript), `react-swc-ts`. Use `.` as name only when the target folder is empty.
   - If this fails because of the network ("blocked", ETIMEDOUT, E403): STOP using npm. Tell the user installs are blocked and switch to `static-web-app` (vanilla ES modules). Do not retry in a loop.
4. Install (slow on this machine: 20 s to several minutes). Run in background and poll once per wait, never in a tight loop:
   ```bash
   cd <app-name> && CI=1 npm install --no-audit --no-fund < /dev/null
   ```
   Use `bash` with `background=true`, then `job_output` until it exits. Or set `timeout_seconds` to 600+. If it fails with a network error, stop and report (same as step 3).
5. Set a relative base in `vite.config.ts` (REQUIRED for preview):
   ```ts
   import react from '@vitejs/plugin-react'
   import { defineConfig } from 'vite'

   export default defineConfig({
     base: './',
     plugins: [react()],
   })
   ```
6. Clean the template: delete `src/App.css`, `src/assets/`, the demo `public/*.svg`, replace `src/index.css` with your base styles, rewrite `src/App.tsx`. In `index.html` change `<title>` and the favicon line (`href="data:,"` avoids a 404).
7. Build the app (see Structure). Write one component per file with `write`. After every 2-3 files run:
   ```bash
   cd <app-name> && npx tsc -b
   ```
   Fix every error before continuing.
8. Production build:
   ```bash
   cd <app-name> && npm run build
   ```
   Output goes to `<app-name>/dist/`. Check that `dist/index.html` contains `src="./assets/` (relative). If it shows `src="/assets/`, `base` is missing.
9. Show it: `preview {path: "<app-name>/dist/index.html"}`. Do NOT preview the dev server (HMR/WebSocket does not work through the preview).
10. After each later change: rebuild, then call `preview` again.

## Structure (small apps)
```
src/
  main.tsx            entry (keep the template's)
  App.tsx             layout + wiring only
  types.ts            shared types
  state.ts            reducer / pure logic (no React imports)
  components/Foo.tsx  one component per file, named export, Props interface
  hooks/useFoo.ts     reusable stateful logic
  index.css           CSS variables + base styles
```
- Split when a file passes ~150 lines. One `write` per file.
- Local state: `useState`. Several related fields or actions: `useReducer` with a typed `Action` union. Share state through props; use Context only when props go 3+ levels deep. Do not add Redux/Zustand/routers unless asked.
- Single page: no router. Switch views with a `view` state value (`'list' | 'detail'`) if needed. If the user wants URLs, use hash routing only (`location.hash`), because the preview is served under a path prefix.
- Derived values (filtered list, totals) are computed during render, not stored in state.
- Lists need stable `key` (`id`, never the array index for editable lists).
- Persist data with `localStorage` in try/catch (the preview can throw):
  ```ts
  function load<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  }
  ```
- Data files: put JSON in `public/data.json` and load with a RELATIVE url: `fetch('data.json')`. Never `fetch('/data.json')`. Or `import data from './data.json'`.
- Styling: plain CSS in `index.css` (variables, light + dark) or CSS modules. For design quality load `frontend-design`.

## Typical errors and fixes
| Symptom | Fix |
|---|---|
| `TS6133 'x' is declared but never used` | Remove the unused import/variable (the template turns this on; the build fails). |
| `TS1484 ... must be imported using a type-only import` | `import type { Foo } from './types.ts'` or `import { useState, type FormEvent } from 'react'`. |
| `TS1294 This syntax is not allowed when 'erasableSyntaxOnly'` | No `enum`, no `namespace`, no constructor parameter properties. Use union types / `as const` objects. |
| `Cannot find module './Foo'` | Add the extension the template uses: `'./Foo.tsx'` (imports with `.ts`/`.tsx` are allowed). |
| White page in preview, 404 on `/assets/...` | `base: './'` missing or you previewed the wrong file. Rebuild and preview `dist/index.html`. |
| `Objects are not valid as a React child` | Render `obj.name`, not `obj`. |
| Infinite re-render loop | Never call `setState` in the render body; put it in an event handler or `useEffect` with correct deps. |
| `Cannot find module 'x'` after adding an import | `npm install x --no-audit --no-fund` (check the network rule above), then rebuild. |
| `npm run build` hangs/OOM | Retry once with `NODE_OPTIONS=--max-old-space-size=768 npm run build`. |

## Rules
- Every file complete: no `...`, no `// TODO`, no empty handlers. Code shown only in your reply is not saved: use `write`.
- Do not run `npm run dev` (blocks, and cannot be previewed). If you must run a server, use `background=true`.
- Do not edit `package-lock.json` by hand; do not commit `node_modules`/`dist` (the platform handles git).
- Add dependencies sparingly (each install is slow). Fine: `react`, `react-dom`. Ask before adding UI kits.
- Do not repeat a failing command with the same arguments; read the error first.
- Keep disk in mind: `node_modules` is 50-150 MB.

## Verify (all must pass)
```bash
cd <app-name>
npx tsc -b && npm run build
grep -c 'src="./assets/' dist/index.html     # expect 1
grep -rn "fetch(['\"]/" src || echo "no root-absolute fetch"
```
Then `preview {path: "<app-name>/dist/index.html"}`. You cannot click through the page: say what you verified (types, build) and what you did not (runtime behavior in a browser).

## Final answer
- What the app does, main files (`src/App.tsx`, ...), how to run later (`npm install`, `npm run dev`, `npm run build`).
- Verification done (tsc, build) and known limits (no real-browser test, storage may be disabled in preview).
