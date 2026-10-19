---
name: static-web-app
description: Build a dependency-free multi-file web page, small web app or browser GAME with plain HTML, CSS and JavaScript (ES modules, optional CDN libraries), then show it with preview. Use when the user wants a game, a web page, a landing page, a calculator, a canvas animation or any small front-end that needs no build step. Do not use for React/Vite projects (use vite-react-app) or mobile apps (use expo-react-native).
triggers: [oyun, game, oyun yap, web sayfası, web page, website, web sitesi, html, canvas, javascript, vanilla js, landing page, açılış sayfası, yılan oyunu, snake, tetris, pong, platform oyunu, hesap makinesi, calculator, sayaç, timer, saat, clock, quiz, animasyon]
---

# Static web app / browser game (HTML + CSS + JS, no build)

## When to use
- Game, toy, calculator, timer, quiz, landing page, visualization, animation, small tool.
- User did not ask for a framework and the repo has no `package.json` front-end.
- Work offline-friendly: no `npm install`. CDN libraries are allowed (see Rules).

## When NOT to use
- User asks for React / Vite / TypeScript app: load `vite-react-app`.
- The repo already has a front-end build (package.json with vite/next/webpack): edit that project instead.
- Pure visual polish of existing UI: load `frontend-design`.

## Workflow
1. Pick a folder: new folder named after the project (for example `snake-game/`). If the repo already has a static site, put files next to it. Never overwrite existing files without reading them first.
2. For 3+ steps write a `todo` plan first: structure, logic, controls, polish, verify, preview.
3. Create files with `write`, one per call, in this order:
   - `index.html` (markup only, relative links)
   - `style.css`
   - `app.js` (entry; `<script type="module" src="app.js">`)
   - extra modules when `app.js` would pass ~300 lines: `game.js`, `input.js`, `render.js`, `storage.js` (import with relative paths: `import { x } from './input.js'`).
4. Run `node --check` on every JS file (ES modules: `node --input-type=module --check < app.js`). Fix errors.
5. Test pure logic (scoring, collision, state updates) with a tiny `node` script when the logic is separable. Keep logic functions free of `document`/`window` so this works.
6. Call `preview {path: "<folder>/index.html"}`.
7. Final answer (see bottom).

## Skeleton (copy, then extend; do NOT leave placeholders)
`index.html`
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Snake</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="app">
    <header class="bar"><h1>Snake</h1><div>Score <b id="score">0</b> · Best <b id="best">0</b></div></header>
    <canvas id="game" width="360" height="360" aria-label="Game board"></canvas>
    <div class="pad" aria-label="Controls">
      <button data-key="ArrowUp" aria-label="Up">▲</button>
      <button data-key="ArrowLeft" aria-label="Left">◀</button>
      <button data-key="ArrowDown" aria-label="Down">▼</button>
      <button data-key="ArrowRight" aria-label="Right">▶</button>
    </div>
    <button id="restart" type="button">Restart</button>
  </main>
  <script type="module" src="app.js"></script>
</body>
</html>
```
`style.css` (full-height, no page scroll while playing, touch friendly)
```css
:root { --bg:#10131a; --fg:#e8ecf4; --accent:#4cc9a0; --card:#1a1f2b; }
@media (prefers-color-scheme: light) { :root { --bg:#f4f6fa; --fg:#151a24; --card:#fff; } }
* { box-sizing: border-box; }
html, body { margin:0; min-height:100%; background:var(--bg); color:var(--fg); font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.app { max-width:480px; margin:0 auto; padding:16px; display:grid; gap:12px; justify-items:center; }
.bar { width:100%; display:flex; justify-content:space-between; align-items:baseline; }
h1 { margin:0; font-size:1.25rem; }
canvas { width:100%; max-width:420px; aspect-ratio:1; background:var(--card); border-radius:12px; touch-action:none; }
.pad { display:grid; grid-template-columns:repeat(3,64px); grid-template-areas:". up ." "left down right"; gap:8px; }
.pad [data-key=ArrowUp]{grid-area:up} .pad [data-key=ArrowLeft]{grid-area:left} .pad [data-key=ArrowDown]{grid-area:down} .pad [data-key=ArrowRight]{grid-area:right}
button { min-height:48px; border:0; border-radius:10px; background:var(--accent); color:#06231a; font:inherit; font-weight:600; cursor:pointer; touch-action:manipulation; user-select:none; }
button:focus-visible { outline:3px solid var(--fg); outline-offset:2px; }
@media (hover:hover) and (pointer:fine) { .pad { display:none; } }  /* hide on-screen pad for mouse+keyboard users */
```

## Game rules of thumb (full code in references)
Read the patterns with `skill {name: "static-web-app", file: "references/game-patterns.md"}` before writing any game. It has: fixed-timestep loop, HiDPI canvas, input manager (keyboard + touch swipe + on-screen buttons), collision, grid/tick games, storage helper, WebAudio beeps.
- Loop: `requestAnimationFrame` + fixed update step (1/60 s) + render. Never move things by "per frame" amounts.
- Pause when the tab is hidden (`visibilitychange`) and cap the frame delta (max 0.1 s).
- Game states: `ready` -> `playing` -> `paused` -> `over`. Show text on the canvas or an overlay for each. Space/Enter/tap starts and restarts.
- Controls: keyboard (arrows + WASD + Space), touch (swipe on the canvas or on-screen buttons), always both. Call `preventDefault()` on arrow/space keys so the page does not scroll.
- Difficulty ramps up with score; show score and best score. Keep one `state` object and one `reset()` function.
- Animation: CSS transitions for UI, canvas for the game; respect `prefers-reduced-motion` for decorative motion.
- Sound: WebAudio beep helper from the references; start audio only after the first user gesture; provide a mute toggle.

## Rules
- All URLs relative: `app.js`, `./img/a.png`, `fetch("data.json")`. Never `fetch("/x")`, never `http://localhost`.
- `localStorage` and `sessionStorage` ONLY inside try/catch (the preview can throw). Game must work with storage unavailable.
- CDN libraries only from `https://cdn.jsdelivr.net/npm/<pkg>@<exact version>/...` or `https://cdnjs.cloudflare.com/...`, pinned to an exact version, used via `<script type="module">` imports or `<script src>`. Prefer no library for simple games.
- Real, finished content: no `...`, no TODO, no "add your code here". Every button must do something.
- Write files with `write`; code shown only in your reply is not saved.
- One file per `write`; keep each under ~300 lines; split into modules instead of one giant file.
- Images: draw with canvas/CSS/SVG/emoji. Do not reference image files you did not create. No external image URLs.
- Never open `index.html` through `file://` logic or a dev server: use `preview` on the HTML file.
- Mobile first: `viewport` meta, `touch-action: none` on the game canvas, buttons >= 44 px, no hover-only controls, layout works at 360 px width.
- Accessibility basics: `lang`, `<title>`, real `<button>`s with labels, visible focus.

## Verify (run all before saying done)
```bash
cd <folder>
for f in *.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done
grep -nE 'src="/|href="/|fetch\(.?/|localhost' index.html *.js *.css || echo "relative URLs ok"
grep -n "localStorage" *.js        # each hit must be inside try/catch
grep -nE '\.\.\.$|TODO|FIXME' *.js *.html *.css || echo "no placeholders"
```
Then `preview {path: "<folder>/index.html"}`. If you cannot see the result, say so; do not claim the game "looks great".

## Final answer
- 2-4 lines: what it is, controls (keyboard + touch), file list with paths.
- Mention what you checked (syntax check, logic test) and what you could not (real browser run).
- Offer one or two concrete next steps (levels, sounds, high-score reset).
