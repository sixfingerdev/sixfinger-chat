---
name: frontend-design
description: Make a user interface look deliberately designed instead of generic AI output: typography, spacing scale, neutral palette with one accent, light and dark themes via CSS variables, responsive layout, interaction states, accessibility and a final checklist. Use together with any web UI task (page, app, dashboard, form) or when the user asks to improve, restyle or polish how something looks. Do not use for backend work or game logic.
triggers: [tasarım, design, arayüz, ui, ux, css, stil, style, tema, theme, koyu tema, dark mode, açık tema, güzel, şık, modern, görünüm, renk, color, font, yazı tipi, responsive, duyarlı, mobil uyumlu, düzen, layout, güzelleştir, redesign, landing page, polish]
---

# Frontend design: make it look intentional

## When to use
- Any new page, app or dashboard where looks matter (almost always).
- "Make it prettier / modern / clean / dark mode / responsive / fix the layout".
- Load it WITH `static-web-app` or `vite-react-app` (this skill covers looks only; those cover structure).

## When NOT to use
- Backend, CLI, data work, game mechanics.
- Pixel-matching a design the user supplied: follow their design, use only the checklist.

## Workflow
1. Decide in one sentence: what is this for, who uses it, which mood (calm, playful, serious, technical). Reuse the project's existing colors/fonts if it has any: read its CSS first.
2. Start from the starter stylesheet. Read it with `skill {name: "frontend-design", file: "references/starter.css"}` and copy it with `write` into the project (`style.css` or `src/index.css`). Change only the `--accent*` tokens (and `--font` if you add a web font).
3. Build mobile first: write the 360 px layout, then add `@media (min-width: 720px)` upgrades.
4. Implement every state (see States), then run the Checklist at the bottom.
5. Verify with `preview` (see the project's skill). Say what you could not check (real devices, real browsers).

## Typography
- Default: system font stack (`--font` in the starter). Zero loading cost, always sharp.
- Optional ONE web font, only when the mood needs it (headline-style pages): a single Google Fonts family, max two weights.
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
  ```
  `font-family: "Inter", system-ui, sans-serif;`. The page must look fine if the font fails to load (offline, blocked).
- Body 16 px minimum, line-height 1.5, line length <= 65ch (`max-width: 65ch` on text blocks).
- Scale: 14 / 16 / 20 / ~32 / ~56 px (starter tokens). Use at most 3 sizes + 2 weights (400, 600) per screen. Headings tight (`line-height: 1.2`), titles `text-wrap: balance`.
- No ALL CAPS paragraphs, no centered long text, no letter-spacing on lowercase body text.
- Numbers in tables/stats: `font-variant-numeric: tabular-nums`.

## Spacing and layout
- Use ONLY the spacing tokens `--s-1` ... `--s-8` (4, 8, 12, 16, 24, 32, 48, 64 px). No random `13px`/`37px`.
- Group related things closer than unrelated things (proximity): gap inside a card `--s-3`, between cards `--s-4`/`--s-5`, between sections `--s-7`+.
- Page container: `width: min(100% - 32px, 1080px); margin-inline: auto`.
- Layout tools: `display:grid` with `repeat(auto-fit, minmax(min(100%, 240px), 1fr))` for card grids; `flex` with `gap` for rows and toolbars. No floats, no fixed pixel widths on containers, no horizontal page scroll at 360 px.
- Align to one left edge. Left-align text by default; center only short hero text and empty states.
- One primary action per view (filled accent button); others secondary or ghost.

## Color
- Neutral surfaces + exactly ONE accent. Status colors (danger/success) only for status.
- Never hard-code colors in components: always `var(--token)`. Define light AND dark tokens (`:root` + `@media (prefers-color-scheme: dark)` + optional `[data-theme]`), as in the starter.
- Dark theme is NOT inverted light: lower surface contrast, softer accent, text `#ececef` not pure white, no pure black background.
- Contrast: body text >= 4.5:1, large text and UI borders >= 3:1. The starter palette passes; if you change colors, check them. Never gray text lighter than `--text-muted`.
- Never convey meaning by color alone (add text or an icon for errors/success).
- Avoid: purple-to-blue gradients, neon glows, rainbow cards, gradient text, glassmorphism blur, big colored drop shadows.

## States (build ALL of them)
| State | Required treatment |
|---|---|
| Hover | Subtle change (background shade, border color). Only for `(hover: hover)` devices; never the only cue. |
| Focus | Visible ring on `:focus-visible` (starter has it). Never `outline: none` without a replacement. |
| Active / pressed | 1 px shift or darker shade. |
| Disabled | `opacity: .5`, `cursor: not-allowed`, real `disabled` attribute. |
| Empty | Short message + the action that fixes it ("No tasks yet. Add your first one."). Never a blank area. |
| Loading | Skeleton or spinner + text for screen readers (`role="status"`). Disable the submit button while sending. |
| Error | Plain-language message near the problem, `role="alert"`, how to recover. Keep the user's input. |
| Success | Brief confirmation (inline text or toast), not a blocking dialog. |

## Responsive
- `<meta name="viewport" content="width=device-width, initial-scale=1">` always.
- Touch targets >= 44 x 44 px, >= 8 px apart. Form font size >= 16 px (prevents iOS zoom).
- Navigation: <= 4 items fit in a row on mobile; more: wrap, scroll horizontally in a tab bar, or use a disclosure button. Test layout at 360, 768, 1280 px widths mentally by reading the CSS.
- Tables on mobile: wrap in `overflow-x:auto` or restyle rows as stacked cards.
- Images/canvas: `max-width:100%; height:auto`. Use `aspect-ratio` to avoid layout jumps.
- Use `min-height: 100dvh` (not `100vh`) for full-screen layouts.

## Accessibility
- Semantic tags: `header`, `nav`, `main`, `section`, `button`, `a`, `ul`. A clickable `div` is a bug: use `<button>`.
- Every input has a visible `<label for="id">`. Icon-only buttons get `aria-label`. Images get `alt` (empty `alt=""` if decorative).
- One `<h1>`; headings in order. `<html lang="...">` matches the content language.
- Keyboard: everything reachable with Tab, in visual order; Escape closes dialogs.
- Motion: keep it short (120-200 ms, ease-out), animate `opacity`/`transform` only, wrap decorative motion with `@media (prefers-reduced-motion: reduce)` (starter has the global rule).

## Icons and emoji
- Prefer inline SVG (simple strokes, `currentColor`, 20-24 px, one stroke width) or no icon at all. Never an icon next to every heading.
- Emoji: allowed as content (a game sprite, a mood, a category) but NOT as UI chrome (nav icons, button icons, bullets, section headers). At most one decorative emoji on a whole page, and none in professional apps.
- Do not hotlink icon fonts or image URLs you have not verified.

## Content (looks bad when generic)
- Real copy in the user's language: specific headings ("Track your weekly budget"), not "Welcome to our amazing platform". No lorem ipsum, no "Feature 1/2/3".
- Realistic sample data (names, numbers, dates) when demonstrating a dashboard. Say it is sample data.
- Avoid the stock template: hero + three equal icon cards + gradient button + testimonials. Ask what this page needs; vary section layout.

## Checklist (verify before you finish)
- [ ] Colors only via CSS variables; light AND dark both defined; accent used for primary actions/links only.
- [ ] Text contrast >= 4.5:1; muted text still readable.
- [ ] Spacing from the scale; consistent radius and border style.
- [ ] <= 3 font sizes + 2 weights per screen; line length <= 65ch.
- [ ] Works at 360 px: no horizontal scroll, buttons >= 44 px, text >= 16 px.
- [ ] Hover, focus-visible, disabled, empty, loading, error states exist.
- [ ] Labels on inputs, `aria-label` on icon buttons, semantic tags, `lang` set.
- [ ] `prefers-reduced-motion` respected; animations <= 200 ms.
- [ ] No placeholder text, no broken image links, no emoji used as UI icons.
- [ ] Only relative URLs; `localStorage` (theme choice) wrapped in try/catch.
Quick greps: `grep -nE '#[0-9a-fA-F]{3,6}' *.css | grep -v -- '--'` (stray hard-coded colors), `grep -n 'outline: *none' *.css` (must have a replacement).

## Final answer
- Describe the design decisions in 2-3 lines (palette, font, layout idea), list files changed, state what you verified and what needs a real device check.
