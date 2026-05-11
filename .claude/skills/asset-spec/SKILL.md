---
name: asset-spec
description: Write a concrete visual/technical spec for a new sprite or asset batch before drawing it — character palette, furniture category, floor/wall pattern, or UI icon. Produces a checklist + Midjourney/SD prompt that downstream art work can follow without guessing dimensions or naming.
when_to_use: Before drawing/commissioning a new character palette (7th+), a new furniture category or group, new floor patterns, new wall pieces, or a new UI icon set. Also use before importing an external asset pack to produce a mapping spec.
---

# Asset Spec — Pixel Agents

Produce a tight, implementable spec for a batch of pixel-art assets. The output is one markdown file per batch; it tells you (or a future you) the exact dimensions, naming, catalog shape, and visual rules before a single pixel is drawn.

**Output**: `docs/asset-specs/<batch-name>.md`

---

## Phase 1: Parse the target

Expect arguments like:

- `character-palette:<name>` — a new character palette beyond the shipped 6
- `furniture:<category>` — e.g. `furniture:electronics` or `furniture:lamps`
- `furniture-group:<groupId>` — one rotation group (e.g. `L_SHAPED_DESK`)
- `floor:<name>` — a new floor pattern
- `walls:<name>` — a new wall set
- `ui-icon:<name>` — a new in-app icon (toolbar button, bubble, etc.)
- `external-pack:<path>` — map an existing external pack into the catalog

If no argument, ask which of the above.

---

## Phase 2: Gather context

Read before asking anything:

1. `docs/art-direction.md` — visual rules. If missing, stop: "Run `/art-direction` first; specs anchor to the art-direction doc."
2. `CLAUDE.md` sections `Office UI` and `Asset System` — dimensions, load order, catalog fields.
3. `webview-ui/src/office/sprites/spriteData.ts` — existing sprite constants.
4. `webview-ui/public/assets/furniture-catalog.json` (bundled catalog) — existing IDs, naming patterns, groupIds.
5. For external packs: the pack's own `furniture-catalog.json` and PNG folder structure.

Report back a context brief:

> Target: [type]:[name]. Art-direction doc: found. Existing catalog IDs nearby: [3–5 related entries]. Next free ID prefix: [e.g. `LAMP_*` not yet used].

---

## Phase 3: Identify the asset list

Produce the concrete list of files that need to exist. Rules of thumb per target type:

- **character-palette**: exactly 1 PNG at 112×96 (7 frames × 3 rows). Named `char_<index>.png` in `webview-ui/public/assets/characters/`.
- **furniture category**: variable — enumerate each item. For each item, note whether it needs rotation variants (front/back/left/right) and state variants (on/off for electronics).
- **furniture-group**: 2–4 orientation variants sharing a `groupId`. Example: `DESK_L_FRONT`, `DESK_L_BACK`, `DESK_L_LEFT`, `DESK_L_RIGHT`.
- **floor**: append to `floors.png` (add one 16×16 grayscale pattern). Update palette index count.
- **walls**: full 4×4 auto-tile set (16 pieces of 16×32). Script `scripts/generate-walls.js` for regeneration.
- **ui-icon**: inline SVG or PNG per `webview-ui/src/components/` usage. Include hover/active states if applicable.

Present the list. Confirm before moving on:

> "Identified [N] assets for [target]. Proceed to spec, or add/remove items?"

---

## Phase 4: Spec each asset

For each asset, draft this block:

```
### ASSET — <id>

| Field            | Value |
|------------------|-------|
| Catalog ID       | `CATALOG_KEY` (must be unique in furniture-catalog.json) |
| File path        | `webview-ui/public/assets/<subdir>/<file>.png` |
| Dimensions       | `<cols>×<rows>` tiles → `<px_w>×<px_h>` pixels |
| Footprint        | `[rows, cols]` in tiles |
| Category         | desks | chairs | storage | electronics | decor | wall | misc |
| Orientation      | front | back | left | right | n/a |
| State            | on | off | n/a |
| groupId          | (if part of a rotation/state group) |
| canPlaceOnWalls  | true | false |
| canPlaceOnSurfaces | true | false |
| backgroundTiles  | <N> (top N rows are walk-through / stackable) |

**Visual description** (2–3 sentences, anchored to docs/art-direction.md rules):
- Silhouette: <what makes it read at 1x zoom>
- Palette: <which shade stops>
- Detail: <any animation frames or variants>

**Art-direction anchors**:
- §2 Color System: <rule applied>
- §3 Shape: <rule applied>

**Generation prompt** (for Midjourney/Stable Diffusion, skip for hand-drawn):
```

pixel art, 16×32 sprite, office <item>, flat colors no gradients no dithering,

<style keywords>, top-down-ish 3/4 view matching pixel-agents aesthetic,
negative: anti-aliasing, blur, photorealistic, outline
```

**Integration checklist**:
- [ ] PNG placed at `<path>`
- [ ] Catalog entry added to `furniture-catalog.json` (or run `scripts/5-export-assets.ts`)
- [ ] `assetLoader.ts` picks it up on next extension reload
- [ ] Shows up in editor palette under [category] tab
- [ ] `pickDiversePalette()` / `layoutToSeats()` behavior verified (for characters / chairs)
```

For **character palettes**, the block is simpler:

```
### CHAR_<index>

| Field            | Value |
|------------------|-------|
| File             | `webview-ui/public/assets/characters/char_<index>.png` |
| Dimensions       | 112×96 (7 frames × 3 rows × 16 wide × 32 tall) |
| Index            | <next free index, 6 if first new one> |

**Palette stops**: skin, hair, shirt, pants, shoes — 2–3 shades each.
**Distinguishing trait**: <what makes this palette visually distinct from char_0..char_5>
**Generation**: use `scripts/export-characters.ts` with CHARACTER_PALETTES entry or author in Aseprite against template.
```

---

## Phase 5: Write the spec file

Ask: "Write this spec to `docs/asset-specs/<batch-name>.md`?"

Create the directory if missing. After writing, suggest:

- Draw/commission against the spec.
- Run `/asset-audit` once files land to verify compliance.

---

## Rules

- Never invent a catalog field — if it's not in `FurnitureCatalogEntry` / the shipping catalog, ask before adding it.
- Never spec dimensions that break the pixel grid (all tiles 16×16; characters 16×24 visible in 16×32 frame).
- Reference `docs/art-direction.md` by section for every visual rule cited — if the rule isn't there yet, write it there first.
- For external asset packs, the #1 check is `category === 'electronics'` for computer-likes so work-seat detection works (`layoutToSeats` / `facesComputer`).

---

## Project adaptations

- Replaced GDD/level/character doc inputs with Pixel Agents' own surfaces (furniture catalog, character PNGs, floor/wall PNGs).
- Dropped the `asset-manifest.md` global tracking table — this is a solo project; file-based specs per batch is enough.
- Dropped `art-director` / `technical-artist` subagent fan-out. The maintainer drafts directly; superpowers:brainstorming is available if visual direction needs exploration first.
- Added the external-asset-pack path as a first-class target type — it's a recurring integration need.
- Catalog field list mirrors the real `FurnitureCatalogEntry` shape (orientation, state, canPlaceOnWalls, canPlaceOnSurfaces, backgroundTiles) instead of generic "Asset Standards Tier 2" language.
