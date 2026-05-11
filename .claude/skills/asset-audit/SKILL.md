---
name: asset-audit
description: Scan Pixel Agents' sprite/PNG assets and the furniture catalog for drift — missing files, orphaned PNGs, catalog entries without files, wrong dimensions, broken groupIds, missing orientation sets, electronics miscategorized (breaks work-seat detection). Read-only; produces a report.
when_to_use: After importing an external asset pack, after a batch of new furniture was added, before releasing a new extension version, or when the office renders broken sprites / characters don't claim work seats as expected.
---

# Asset Audit — Pixel Agents

Read-only scan of the asset pipeline. Outputs a written verdict; does not modify files.

---

## Phase 1: Load the sources of truth

1. `docs/art-direction.md` — dimension and naming rules (if present). Missing is not fatal but flag it.
2. `webview-ui/public/assets/furniture-catalog.json` — bundled catalog.
3. `CLAUDE.md` → `Asset System` section — load order, naming convention, category rules.
4. `webview-ui/src/office/layout/furnitureCatalog.ts` — code that consumes catalog entries.
5. External asset dirs configured in `~/.pixel-agents/config.json` (if any) — read and note which packs merge in.

---

## Phase 2: Run compliance scans

Use Glob/Grep only. Do not modify anything.

### 2a — Character PNGs

- Glob `webview-ui/public/assets/characters/char_*.png`.
- Each must be exactly `112×96` and named `char_<N>.png` where N starts at 0 and is contiguous.
- Flag: gaps in index, wrong dimensions, non-`char_` naming.

### 2b — Floor and wall PNGs

- `webview-ui/public/assets/floors.png` — width must be a multiple of 16, height exactly 16.
- `webview-ui/public/assets/walls.png` — 64×128 (4×4 grid of 16×32 pieces).
- Flag if dimensions mismatch.

### 2c — Furniture catalog ↔ PNG files

For each catalog entry:

- Verify a matching PNG exists (path convention: `webview-ui/public/assets/furniture/<id>.png` or equivalent; check actual asset loader path).
- Verify footprint dimensions match the PNG: `footprint.rows * 16` height, `footprint.cols * 16` width (allowing extra top pixels for tall sprites like walls).
- Flag: missing PNG, oversized/undersized PNG.

For each PNG in the furniture asset dirs:

- Verify a catalog entry exists whose id matches (or whose PNG path points at it).
- Flag: orphaned PNGs (no catalog entry).

### 2d — Rotation group integrity

- Group catalog entries by `groupId`.
- For each group: list its orientations. Flag:
  - Groups with only 1 member (either mark explicit, or complete the set).
  - Groups where orientation values are inconsistent (e.g. mix of `front`/`forward`).
  - Groups where one variant sets `isDesk: true` but a sibling doesn't.

### 2e — State group integrity

- For each group with `state: 'on' | 'off'` entries: verify both states exist and share `groupId` + `orientation`.
- Flag: on-without-off, off-without-on.

### 2f — Work-seat readiness

- Find all catalog entries with `category: 'electronics'`. These are the anchors that make nearby chairs work-seats.
- If an external pack ships monitor-like items with a different category (e.g. `misc`, `decor`), flag loudly — this is the #1 integration break for work-seat detection (`layoutToSeats` / `facesComputer`).
- Also flag chairs with no `orientation` set — facing direction defaults to DOWN and may not match desk layout.

### 2g — Wall / surface / background integrity

- `canPlaceOnWalls: true` → category should be `wall`. Flag mismatches.
- `canPlaceOnSurfaces: true` → surfaces like laptops/mugs should have footprint ≤ 1×2 and be non-desk. Flag oversized surface items (they may render wrong with the +0.5 z-bias).
- `backgroundTiles` > 0 → warn if it equals or exceeds the footprint rows (every row walkable = item is effectively floor).

### 2h — Catalog field sanity

- Required fields per entry: `id`, `name`, `label`, `category`, `footprint`.
- Optional-but-sensitive fields: `groupId`, `orientation`, `state`, `canPlaceOnWalls`, `canPlaceOnSurfaces`, `backgroundTiles`, `isDesk`.
- Flag entries missing required fields.
- Flag entries where `category: 'wall'` but `canPlaceOnWalls !== true` (or vice versa).

### 2i — Referenced but not loaded

- Grep `webview-ui/src/` for string literal furniture IDs. For each hit, verify the ID exists in the catalog.
- Flag: code references an id that no longer exists.

---

## Phase 3: Output the report

Markdown, plain tables. Do not write to disk.

```
# Asset Audit Report — <date>

## Summary
- Catalog entries: <N>
- Furniture PNGs on disk: <N>
- Character PNGs: <N> (expected contiguous 0..<M-1>)
- External packs scanned: <list or "none">
- Overall: CLEAN | WARNINGS | NEEDS ATTENTION

## Missing PNGs (catalog entry with no file)
| id | expected path |

## Orphaned PNGs (file with no catalog entry)
| path | reason flagged |

## Dimension mismatches
| id / file | expected | actual |

## Rotation groups with gaps
| groupId | present orientations | missing |

## State groups with gaps
| groupId + orientation | present states | missing |

## Work-seat risks (electronics miscategorized, chairs missing orientation)
| id | issue |

## Wall / surface / background issues
| id | issue |

## Missing required catalog fields
| id | missing field(s) |

## Code references to missing catalog ids
| file:line | missing id |

## Verdict
CLEAN | WARNINGS | NEEDS ATTENTION
```

---

## Phase 4: Suggest next steps

- If NEEDS ATTENTION: fix the blockers, then rerun.
- If external pack flagged: open `asset-manager.html` (the unified editor in `scripts/`) to re-categorize — specifically flip monitors to `electronics`.
- If orphaned PNGs: either run `scripts/5-export-assets.ts` to regenerate the catalog, or delete the PNG.
- If rotation groups incomplete: run `/asset-spec furniture-group:<groupId>` to spec the missing orientations.

---

## Project adaptations

- Replaced generic `assets/art/**` / `assets/audio/**` paths with the actual Pixel Agents layout (`webview-ui/public/assets/` + external dirs from `~/.pixel-agents/config.json`).
- Replaced "power-of-two textures, OGG/MP3 audio" checks with pixel-grid alignment and catalog schema checks.
- Added the critical `category: 'electronics'` check for work-seat detection — a bug this project actually hits with external packs.
- Added rotation/state group integrity scans tied to the real `groupId` system in `furnitureCatalog.ts`.
- Removed audio scans entirely — the only audio is a single Web Audio API chime, not a library.
