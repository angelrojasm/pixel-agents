---
name: art-direction
description: Author or update the single-file visual identity spec for Pixel Agents — the pixel-art office, characters, furniture, bubbles, matrix effects, and UI chrome. Use before bulk asset work (new character palettes, furniture categories, wall sets, HSBC defaults) so downstream assets stay coherent.
when_to_use: Before commissioning or drawing a new batch of sprites (characters, furniture categories, floor/wall sets, UI icons), when the existing art feels inconsistent and you need a written rule to resolve it, or when onboarding an external asset pack and needing to state what "fits".
---

# Art Direction — Pixel Agents

Pixel Agents has **one** visual identity document. It gates every new sprite, color, and UI chrome decision. Output lives at `docs/art-direction.md` (create if missing).

This is NOT a AAA game art bible — it's a single-maintainer reference for keeping the pixel-art office coherent as new assets come and go. Keep it tight; no fluff.

---

## Phase 0: Check for existing doc

Glob `docs/art-direction.md`.

- **If it exists** — read it in full. For each section below, mark it `Complete` / `Empty` / `Stale` (contradicts current `CLAUDE.md` or `spriteData.ts`). Present the status table and only work on sections that are Empty or Stale. Do not touch Complete sections unless user asks.
- **If it doesn't exist** — fresh authoring. Proceed through all sections.

---

## Phase 1: Ground the session

Read these before writing anything:

1. `CLAUDE.md` — `Office UI`, `Asset System`, `Layout Editor` sections. The art direction must not contradict runtime behavior described there.
2. `webview-ui/src/office/sprites/spriteData.ts` — the fallback template sprites. These define minimum readable detail.
3. `webview-ui/public/assets/characters/char_0.png` … `char_5.png` — the 6 shipped character palettes. The doc must describe what makes a valid 7th+ palette.
4. `webview-ui/public/assets/floors.png` and `walls.png` — the current floor/wall source art.
5. `webview-ui/src/index.css` `:root` block — existing `--pixel-*` CSS variables.

Report back: "Grounded. Shipped sprite counts: [N] characters, [N] floor patterns, [N] furniture categories. Found HSBC defaults at [location]. Ready to draft."

---

## Phase 2: Write each section in order

For each section: draft in conversation, ask for approval, write to `docs/art-direction.md` immediately. Do not batch.

### Section 1 — Visual identity statement (1 paragraph)

One sentence describing the look ("cozy 16px-tile pixel-art office with 24px-tall characters, hard-edged colors, no dithering, no antialiasing") plus 2–3 supporting rules:

- Pixel grid rule (e.g. "all sprite pixels align to the 16px tile grid; no sub-pixel offsets except character sitting-offset of 6px")
- Color rule (e.g. "flat colors with 2–3 shade stops per surface; colorize module handles recoloring")
- Readability rule (e.g. "every furniture silhouette must be identifiable at 1x zoom from 2 tiles away")

### Section 2 — Color system

- **CSS chrome palette**: list the `--pixel-*` variables and their semantic role (bg, border, accent, danger, success). Note which are load-bearing for the pixel-art aesthetic (sharp corners, hard offset shadows, no blur).
- **Character palettes**: document the 6 shipped palettes (name each — e.g. "warm-brown", "cool-blue") and the rule for adding a 7th+ (use `hueShift` via `adjustSprite()` in `colorize.ts`, 45°–315° avoiding the shipped hues).
- **Floor/wall colorize**: HSBC mode is Colorize (Photoshop-style). Document the recommended HSL ranges for "office-neutral" vs accent rooms.
- **Furniture color overrides**: HSBC mode is Adjust. Items left uncolored should render as their authored PNG colors; overrides are for themed rooms only.
- **Bubbles / status overlays**: amber for permission, green for waiting. Do not introduce a third semantic color without updating this doc.

### Section 3 — Shape & silhouette rules

- **Character**: 16×24 visible pixels, bottom-aligned in a 16×32 frame with 8px top padding. 3 direction rows (down, up, right; left = flipped right). 7-frame sheet (walk1, walk2, walk3, type1, type2, read1, read2). Idle = walk2.
- **Furniture**: footprint is in whole tiles. Silhouette must not rely on color alone — a grayscale render should still read.
- **Chairs**: orientation explicit in catalog (`front`/`back`/`left`/`right`). Back-facing chairs render in front of their occupant (see CLAUDE.md z-sort notes).
- **Wall-placed items**: paintings/clocks/windows. Bottom row on wall, upper rows may extend above map.
- **Surface items**: laptops, mugs, monitors on desks. Z-bias of +0.5 over the host desk.

### Section 4 — Motion & feel

- **Matrix spawn/despawn**: 0.3s vertical rain, 16 columns, green #00FF41-ish — document the exact RGB so new effects stay on-brand.
- **Typing/reading animations**: frame timings live in `webview-ui/src/constants.ts`. Document the visible beat ("typing = 3 frames @ ~120ms; reading = 2 frames @ ~180ms") so art and timing stay in sync.
- **Camera**: pixel-perfect zoom (integer DPR × sprite px). Never `ctx.scale(dpr)`. Smooth follow on `cameraFollowId`.
- **Speech bubbles**: permission bubble sticks until cleared; waiting bubble auto-fades at 2s.
- **Juice budget**: list the effects that exist today (matrix, bubbles, HSBC tinting, selection outline). Any new juice must be proposed against this list, not added on top without review.

### Section 5 — UI chrome rules

Echo the non-negotiables from `CLAUDE.md` → "UI styling":

- Sharp corners only (`borderRadius: 0`).
- Solid backgrounds, `2px solid` borders.
- Hard offset drop shadows (`2px 2px 0px #0a0a14`), never blurred.
- FS Pixel Sans everywhere; no fallback font for player-facing text.
- React inline styles pull from CSS variables, not hex literals.

### Section 6 — Asset standards

- **PNG format**: 32-bit RGBA. Alpha threshold 2 (see `PNG_ALPHA_THRESHOLD`). Semi-transparent pixels encoded as `#RRGGBBAA`.
- **Character PNG**: 112×96 (7 frames × 16 wide, 3 rows × 32 tall). Generated via `scripts/export-characters.ts`.
- **Floor PNG**: 112×16 (7 patterns × 16). Grayscale — colorize at runtime.
- **Wall PNG**: 64×128 (4×4 grid of 16×32 auto-tile pieces). Run `scripts/generate-walls.js` to regenerate.
- **Furniture PNGs**: per-item, cropped to footprint; catalog entry in `furniture-catalog.json` is authoritative for bounds. Naming: `{BASE}[_{ORIENTATION}][_{STATE}]`.
- **External asset packs**: must classify their computer-likes as `category: 'electronics'` for work-seat detection to work. Call this out in the doc — it's the #1 integration trap.

### Section 7 — What's out of scope / prohibitions

Short list of "do not":

- No 32-bit gradients, no anti-aliased curves, no blur, no parallax.
- No sub-tile animations that move the whole sprite (characters shift ±1 tile max; effects live in overlay layer).
- No UI chrome that breaks the hard-edged pixel aesthetic (no glassmorphism, no soft shadows).
- No color meanings beyond amber-permission / green-waiting without updating this doc.

---

## Phase 3: Close

Report the final section table and file path. Suggest follow-ups only if relevant:

- Run `/asset-audit` if existing furniture/characters may now violate the newly written rules.
- Run `/asset-spec` to generate specs for the next batch of sprites you plan to draw or commission.

---

## Project adaptations

- Dropped Unity/Godot/Unreal asset standards, LOD tiers, and texture-memory budgets — pixel-art PNGs don't need those.
- Collapsed 9 sections into 7 tuned to this project's actual surfaces (characters, furniture, floors, walls, bubbles, UI chrome).
- Replaced `art-director` / `technical-artist` specialist agent delegation with direct authoring — single maintainer, no studio team.
- Output is a single `docs/art-direction.md`, not a `design/art/` tree.
- Added explicit external-asset-pack trap (category-must-be-`electronics` for work-seat detection) — a real project gotcha.
