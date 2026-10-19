# Game patterns (vanilla JS, ES modules)

Each block is self-contained. Copy what you need into modules (`loop.js`, `input.js`, `storage.js`, ...).

## 1. Fixed-timestep loop (any real-time game)
```js
// loop.js
export function createLoop({ update, render, step = 1 / 60, maxFrame = 0.1 }) {
  let last = 0, acc = 0, rafId = 0, running = false;
  function frame(t) {
    if (!running) return;
    const now = t / 1000;
    const dt = Math.min(now - last, maxFrame);   // cap: tab switch must not teleport things
    last = now;
    acc += dt;
    while (acc >= step) { update(step); acc -= step; }
    render(acc / step);                           // alpha for interpolation (optional)
    rafId = requestAnimationFrame(frame);
  }
  return {
    start() { if (running) return; running = true; last = performance.now() / 1000; acc = 0; rafId = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(rafId); },
    get running() { return running; },
  };
}
// pause automatically when the tab is hidden:
// document.addEventListener('visibilitychange', () => document.hidden && loop.stop());
```
Move with `x += vx * dt` where `dt` is seconds (the fixed `step`). Speeds are in pixels (or cells) per second.

## 2. Sharp canvas on HiDPI screens + responsive size
```js
export function fitCanvas(canvas, logicalW, logicalH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);        // draw in logical units
  return ctx;                                     // CSS: canvas { width:100%; aspect-ratio: W/H }
}
// Pointer position in logical units:
export function pointerPos(canvas, e, logicalW, logicalH) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * logicalW / r.width, y: (e.clientY - r.top) * logicalH / r.height };
}
```

## 3. Input manager: keyboard + swipe + on-screen buttons -> one set of actions
```js
// input.js
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'action', Enter: 'action', KeyP: 'pause', Escape: 'pause',
};
export function createInput(canvas, { onPress = () => {} } = {}) {
  const down = new Set();                         // actions currently held
  const press = (a) => { down.add(a); onPress(a); };
  const release = (a) => down.delete(a);

  addEventListener('keydown', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    e.preventDefault();                           // stop page scrolling
    if (!e.repeat) press(a);
  });
  addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) release(a); });

  // On-screen buttons: <button data-key="ArrowUp">
  document.querySelectorAll('[data-key]').forEach((btn) => {
    const a = KEYMAP[btn.dataset.key];
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(a); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => release(a));
  });

  // Swipe on the canvas (needs CSS touch-action: none); a tap triggers 'action'
  let sx = 0, sy = 0, t0 = 0;
  canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; t0 = performance.now(); });
  canvas.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < 24) { if (performance.now() - t0 < 300) { press('action'); release('action'); } return; }
    const a = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    press(a); release(a);
  });
  return { isDown: (a) => down.has(a) };
}
// Held movement (platformer):  if (input.isDown('left')) player.vx = -200;
// One-shot moves (snake, puzzle): handle in onPress(a).
```
Always release held keys on `blur`: `addEventListener('blur', () => down.clear())` (add inside `createInput`).

## 4. Collision
```js
export const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const circles = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;
export const pointInRect = (px, py, r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

// Platformer: move one axis at a time, then resolve against solid rects.
export function moveAndCollide(p, solids, dt) {
  p.x += p.vx * dt;
  for (const s of solids) if (aabb(p, s)) { p.x = p.vx > 0 ? s.x - p.w : s.x + s.w; p.vx = 0; }
  p.y += p.vy * dt;
  p.onGround = false;
  for (const s of solids) if (aabb(p, s)) {
    if (p.vy > 0) { p.y = s.y - p.h; p.onGround = true; } else { p.y = s.y + s.h; }
    p.vy = 0;
  }
}
// gravity: p.vy += 1600 * dt;  jump: if (p.onGround) p.vy = -620;
```

## 5. Grid / tick games (snake, tetris, 2048, minesweeper)
Update on a timer, render every frame. Keep the board as data (`cells[y][x]`).
```js
// tick.js: run `onTick` every `interval` seconds inside the fixed loop's update()
export function createTicker(onTick, interval) {
  let acc = 0;
  return { interval, update(dt) { acc += dt; while (acc >= this.interval) { acc -= this.interval; onTick(); } } };
}
// Snake core (pure logic, testable in node):
export function stepSnake(s) {
  const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
  const hitWall = head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows;
  const hitSelf = s.snake.some((c) => c.x === head.x && c.y === head.y);
  if (hitWall || hitSelf) return { ...s, over: true };
  const ate = head.x === s.food.x && head.y === s.food.y;
  const snake = [head, ...s.snake];
  if (!ate) snake.pop();
  return { ...s, snake, score: s.score + (ate ? 10 : 0), food: ate ? s.spawnFood(snake) : s.food };
}
// Block 180-degree turns: ignore a new dir if it equals the opposite of the current one.
// Buffer at most one queued direction per tick so fast double-taps are not lost.
```

## 6. Safe storage (best score, settings)
```js
// storage.js
export function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
// const best = load('snake.best', 0);  ...  if (score > best) save('snake.best', score);
```

## 7. Sound with WebAudio (no files)
```js
// sound.js
let ctx = null, muted = false;
export function setMuted(m) { muted = m; }
export function beep(freq = 440, dur = 0.08, type = 'square', vol = 0.05) {
  if (muted) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();   // create after a user gesture
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch { /* audio unavailable: ignore */ }
}
// eat: beep(660, .06)   die: beep(160, .35, 'sawtooth')   level up: beep(880, .12, 'triangle')
```

## 8. Rendering tips
- Clear + redraw the whole canvas each frame: `ctx.clearRect(0, 0, W, H)`.
- Text: `ctx.font = '600 20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(msg, W/2, H/2)`.
- Juice: screen shake (random offset for 150 ms), particles (array of `{x,y,vx,vy,life}`), score pop-ups, easing with `t * t * (3 - 2 * t)`.
- Randomness: `Math.random()`; for daily/seeded games use a small PRNG (mulberry32).
- Emoji as sprites: `ctx.font = '24px serif'; ctx.fillText('🍎', x, y)`.
- Keep colors in a `COLORS` object at the top of the file; read CSS variables with `getComputedStyle(document.documentElement).getPropertyValue('--accent')` if you want theme support.
