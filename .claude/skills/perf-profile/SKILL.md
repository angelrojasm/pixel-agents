---
name: perf-profile
description: Static performance profile of Pixel Agents — canvas render loop, character FSM, z-sort, pathfinding, sprite caches, file watching, JSONL parsing. Identifies likely hotspots against frame budget and memory targets, with prioritized recommendations. Read-only; does not modify code.
when_to_use: When office rendering stutters (more than a handful of agents, large grids, heavy sprite churn), when the extension host feels slow (many JSONL files, hook storms), before enabling a performance-sensitive feature (e.g. more simultaneous matrix effects), or proactively every few releases.
---

# Perf Profile — Pixel Agents

Static analysis of likely performance bottlenecks. Output is a prioritized report. No runtime profiling — this identifies candidates; confirm with Chrome DevTools / Node `--inspect` after.

---

## Phase 1: Determine scope

Argument is one of:

- `render` — webview canvas / rAF loop only
- `backend` — extension host, file watching, JSONL parsing, hook server
- `cache` — sprite caches, colorize caches, catalog dynamic build
- `full` — everything
- no arg → ask

---

## Phase 2: Load budgets

Target budgets (author into this skill until they're codified elsewhere):

| Metric              | Target                   | Notes                                      |
| ------------------- | ------------------------ | ------------------------------------------ |
| Canvas frame        | <= 16.7ms @ 60fps        | rAF in `gameLoop.ts` with 0.1s delta cap   |
| Characters onscreen | 30+ without drop         | FSM + z-sort must scale                    |
| Extension CPU       | < 2% idle                | polling + watcher baseline                 |
| JSONL read          | < 5ms per new-line batch | partial-line buffering in `fileWatcher.ts` |
| Hook POST           | < 20ms round-trip        | local HTTP, `server/src/server.ts`         |
| Memory (webview)    | < 200MB                  | sprite cache + colorize cache              |

If the user has different numbers in mind, record them and use those.

---

## Phase 3: Static analysis

### 3a — Canvas render loop (`render` or `full`)

Read:

- `webview-ui/src/office/engine/gameLoop.ts`
- `webview-ui/src/office/engine/renderer.ts`
- `webview-ui/src/office/engine/characters.ts`
- `webview-ui/src/office/engine/matrixEffect.ts`
- `webview-ui/src/office/sprites/spriteCache.ts`
- `webview-ui/src/office/floorTiles.ts`
- `webview-ui/src/office/wallTiles.ts`

Look for:

- Allocations inside per-frame paths (`renderer.ts`, `characters.ts` update). Any `new Array()`, `.map()`, `.filter()` on large collections each frame is a candidate.
- Z-sort: how does the renderer order entities per frame? If it's a full sort of tiles + furniture + characters + walls every frame, list cost and whether a partial sort is viable.
- Sprite cache lookups: `spriteCache` uses a WeakMap per zoom; on zoom change the entire cache is invalidated — note cost of re-caching all sprites on zoom.
- Matrix effect: per-pixel rendering. Count likely ops = 16 cols × ~24 rows × frame rate. Flag if simultaneous matrix effects scale linearly.
- Character pathfinding: `tileMap.ts` BFS — cached per character? Runs on seat change? Flag if it runs per frame.
- Canvas 2D ops: `ctx.drawImage` with source subrect vs pre-sliced offscreen — document which is used.
- DPR handling: code says "No `ctx.scale(dpr)`" — verify no regression.

### 3b — Backend (`backend` or `full`)

Read:

- `src/fileWatcher.ts`
- `src/transcriptParser.ts`
- `src/agentManager.ts`
- `src/layoutPersistence.ts`
- `server/src/server.ts`
- `server/src/hookEventHandler.ts`

Look for:

- Polling intervals (500ms per-agent JSONL, 1s main scanner, 3s external scanner, 30s stale). Multiply by agent count. If > 5 agents, compound poll load can be visible.
- `fs.watch` + polling fallback — note that both run on Windows. Flag if any path is polled at < 250ms.
- JSONL parsing: `processTranscriptLine` per line. If a session dumps 10k lines (a long Claude run), ensure `readNewLines` only reads the new tail, not the whole file.
- Partial-line buffer growth (unterminated lines held in memory).
- Hook server: synchronous work on the request path; any `await` on disk inside a hook handler is a stall source.
- Layout write: atomic `.tmp` + rename. Debounced?
- `restoreAgents` / `pruneForeignExternalsIfWatchAllOff` on startup — O(N\*M) over persisted agents × external projects.

### 3c — Caches (`cache` or `full`)

Read:

- `webview-ui/src/office/colorize.ts`
- `webview-ui/src/office/sprites/spriteCache.ts`
- `webview-ui/src/office/layout/furnitureCatalog.ts`
- `webview-ui/src/office/engine/officeState.ts` (`rebuildFurnitureInstances`)

Look for:

- Colorize cache key cardinality: (pattern × H × S × B × C × colorize flag). If HSBC sliders produce continuous floats, the cache explodes — flag if not quantized.
- Sprite cache growth: WeakMap per zoom + palette:hueShift key. Per-zoom cache reset on zoom change — how many entries typically rebuild?
- `rebuildFurnitureInstances`: runs on every render? On layout change only? Flag if per-frame.
- Catalog rebuild: `buildDynamicCatalog` on external-pack add/remove — full O(N) rebuild; fine unless external packs add at runtime often.

---

## Phase 4: Produce report

```markdown
## Perf Profile — <scope> — <date>

### Budgets

| Metric             | Target | Estimated current | Status            |
| ------------------ | ------ | ----------------- | ----------------- |
| Frame @ 60fps      | 16.7ms | ~<est>ms          | OK / WATCH / OVER |
| Characters @ 60fps | 30+    | <est>             | OK / WATCH / OVER |
| Extension CPU idle | <2%    | <est>             | OK / WATCH / OVER |
| Webview memory     | <200MB | <est>             | OK / WATCH / OVER |

### Hotspots

| #   | Location             | Issue                                     | Est. impact                                      | Fix effort                                      |
| --- | -------------------- | ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| 1   | `renderer.ts:<line>` | Full z-sort every frame over all entities | Scales O(N log N) per frame; ~3ms @ 200 entities | M — keep a dirty flag, re-sort only on mutation |

### Quick wins (< 1 hr)

- <one-liner>

### Needs runtime confirmation

- <candidate that static analysis can't prove>

### Recommendations (priority order)

1. **<title>** — <description>
   - Location: <file:line>
   - Expected gain: <estimate>
   - Risk: L / M / H
   - Approach: <one paragraph>

### Deferred

<items accepted as known-perf-debt>
```

---

## Phase 5: Decide what to act on

Present M/L effort items. For each, offer:

- **A) Fix now** — proceed to implementation (recommend `superpowers:writing-plans` → `superpowers:executing-plans`).
- **B) Defer** — log under "Deferred" with reason.
- **C) Confirm with runtime profile first** — mark as "needs DevTools trace" and stop.

This skill is read-only. Do not write files.

---

## Rules

- Never optimize without identifying the candidate first.
- Every recommendation names the file + line and gives an estimated impact — "faster" is not actionable.
- Canvas perf is the priority path (it's what the user sees). Backend perf matters but fails silently; flag loudly.
- Runtime profiling (Chrome DevTools Performance tab, Node `--inspect`) confirms; static analysis proposes.

---

## Project adaptations

- Replaced Unity/Godot/Unreal profiling targets with the real ones: canvas rAF loop, z-sort, sprite cache, file watching, hook server.
- Budget tiers are the actual ones that apply to a webview + extension-host app, not a GPU game.
- Added cache-explosion check for HSBC colorize keys — a real risk here.
- Added multi-agent polling load check (500ms × N agents + 1s + 3s + 30s scanners).
- Removed the `performance-analyst` / `engine-programmer` subagent fan-out; single maintainer drives.
