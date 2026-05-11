# Thinking Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make character position carry the meaning of "working vs idle": at a computer = working/thinking, wandering/on a couch = idle. Hover label shows "Thinking…" when the agent is active with no tool running.

**Architecture:** Each chair seat gets a `role: 'work' | 'rest'` computed once per layout change using the same computer-adjacency window that already drives the auto-state feature. `Character.seatId` is renamed to `workSeatId` and a transient `restSeatId?` is added. When `isActive` flips via hooks (now including `UserPromptSubmit`), the character pathfinds to their work seat; when idle, they wander and eventually pick a free rest seat instead of returning to their desk. One new rule in the overlay: `isActive && no active tool → "Thinking…"`.

**Tech Stack:** TypeScript, Vitest (server tests), Node built-in test runner via tsx (webview tests), React (overlay), VS Code webview message protocol.

Spec: `docs/superpowers/specs/2026-04-20-thinking-presence-design.md`.

---

## Task 1: Server — `userTurn` emits `agentStatus: 'active'`

**Files:**

- Modify: `server/src/hookEventHandler.ts:349-352`
- Test: `server/__tests__/hookEventHandler.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block to `server/__tests__/hookEventHandler.test.ts` inside the existing `describe('HookEventHandler', () => { ... })` block, right after the existing PermissionRequest tests:

```typescript
// ── UserPromptSubmit (thinking presence) ───────────────────────

it('UserPromptSubmit sends agentStatus:active', () => {
  const agent = createTestAgent({ id: 1 });
  agents.set(1, agent);
  handler.registerAgent('sess-1', 1);

  handler.handleEvent('claude', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sess-1',
  });

  const msg = mockWebview.messages.find((m) => m.type === 'agentStatus' && m.status === 'active');
  expect(msg).toBeTruthy();
  expect(msg?.id).toBe(1);
});

it('UserPromptSubmit sets hookDelivered on the agent', () => {
  const agent = createTestAgent({ id: 1 });
  agents.set(1, agent);
  handler.registerAgent('sess-1', 1);

  handler.handleEvent('claude', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sess-1',
  });

  expect(agent.hookDelivered).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server -- --testNamePattern "UserPromptSubmit sends agentStatus"`

Expected: FAIL — the `agentStatus:active` message won't be found because the `userTurn` case currently drops the event.

- [ ] **Step 3: Implement the minimal change**

In `server/src/hookEventHandler.ts`, locate the switch block inside `handleEvent` (around line 317). Replace the existing `case 'userTurn':` / `case 'progress':` fallthrough:

```typescript
      case 'userTurn':
      case 'progress':
        // Not yet consumed by the office visualization. Silently drop.
        return;
```

with:

```typescript
      case 'userTurn':
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
        return;
      case 'progress':
        // Not yet consumed by the office visualization. Silently drop.
        return;
```

Note: `agent.hookDelivered` is already set to `true` at line 306 for every routed event, so the second test passes without additional work — but keep both tests because they pin the behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server`

Expected: PASS — all existing tests plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/hookEventHandler.ts server/__tests__/hookEventHandler.test.ts
git commit -m "feat(hooks): emit agentStatus:active on UserPromptSubmit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Webview types — `Seat.role` and `Character.workSeatId`/`restSeatId`

**Files:**

- Modify: `webview-ui/src/office/types.ts:47-57` (Seat), `webview-ui/src/office/types.ts:130-201` (Character)

- [ ] **Step 1: Update `Seat` interface**

In `webview-ui/src/office/types.ts`, replace the existing `Seat` block (lines 47-57):

```typescript
export interface Seat {
  /** Chair furniture uid */
  uid: string;
  /** Tile col where agent sits */
  seatCol: number;
  /** Tile row where agent sits */
  seatRow: number;
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction;
  assigned: boolean;
}
```

with:

```typescript
export interface Seat {
  /** Chair furniture uid */
  uid: string;
  /** Tile col where agent sits */
  seatCol: number;
  /** Tile row where agent sits */
  seatRow: number;
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction;
  /** 'work' if the chair faces a computer (electronics item on a desk tile within the
   *  auto-state adjacency window); 'rest' otherwise. Set by layoutToSeats(). */
  role: 'work' | 'rest';
  assigned: boolean;
}
```

- [ ] **Step 2: Update `Character` interface**

In the same file, replace the `seatId` line (around line 163-164):

```typescript
/** Assigned seat uid, or null if no seat */
seatId: string | null;
```

with:

```typescript
/** Assigned work-seat uid (chair facing a computer), or null if none assignable.
 *  Persistent across sessions. */
workSeatId: string | null;
/** Transient rest-seat uid the character currently occupies or is walking to.
 *  Never persisted; cleared whenever the character leaves the rest seat or becomes active. */
restSeatId: string | null;
```

- [ ] **Step 3: Commit (types only — tree will not yet compile until later tasks)**

The TypeScript compiler will report errors in `officeState.ts`, `characters.ts`, `useExtensionMessages.ts`, and the overlay. Those get fixed in subsequent tasks. Commit the type change alone so the intent is crisp:

```bash
git add webview-ui/src/office/types.ts
git commit -m "refactor(types): split seatId into workSeatId + restSeatId, add Seat.role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract `facesComputer` adjacency helper

**Files:**

- Modify: `webview-ui/src/office/engine/officeState.ts` (extract helper from `findFreeSeat` and `rebuildFurnitureInstances`)
- Create: `webview-ui/test/seat-classification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `webview-ui/test/seat-classification.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { facesComputer } from '../src/office/engine/seatAdjacency.ts';
import { Direction } from '../src/office/types.ts';

test('facesComputer: chair faces a directly-adjacent computer', () => {
  // Chair at (5,5) facing DOWN, computer at (5,6).
  const electronicsTiles = new Set<string>(['5,6']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, true);
});

test('facesComputer: chair faces empty tiles', () => {
  const electronicsTiles = new Set<string>();
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: chair faces AWAY from computer', () => {
  // Chair at (5,5) facing UP, computer at (5,6) (below).
  const electronicsTiles = new Set<string>(['5,6']);
  const result = facesComputer(5, 5, Direction.UP, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: computer within side offset (wide desk)', () => {
  // Chair at (5,5) facing DOWN, computer at (6,6) — one tile to the right,
  // still within the side-offset window.
  const electronicsTiles = new Set<string>(['6,6']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, true);
});

test('facesComputer: computer beyond facing depth', () => {
  // Chair at (5,5) facing DOWN, computer 4 tiles away (beyond AUTO_ON_FACING_DEPTH=3).
  const electronicsTiles = new Set<string>(['5,9']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: horizontal facing checks vertical neighbors', () => {
  // Chair at (5,5) facing RIGHT, computer at (6,4) — above the facing line.
  const electronicsTiles = new Set<string>(['6,4']);
  const result = facesComputer(5, 5, Direction.RIGHT, electronicsTiles);
  assert.equal(result, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webview-ui && npm test`

Expected: FAIL — `../src/office/engine/seatAdjacency.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `webview-ui/src/office/engine/seatAdjacency.ts`:

```typescript
import { AUTO_ON_FACING_DEPTH } from '../../constants.js';
import { Direction } from '../types.js';

/**
 * True if a chair at (seatCol, seatRow) facing `facingDir` has a computer
 * (electronics-category item) within the auto-state adjacency window:
 * AUTO_ON_FACING_DEPTH tiles deep in the facing direction, plus 1 tile to
 * each side perpendicular to the facing direction.
 *
 * The `electronicsTiles` set contains "col,row" keys for every tile covered
 * by an electronics-category furniture item.
 *
 * Kept in its own module so both layoutToSeats (role classification) and
 * officeState.rebuildFurnitureInstances (auto-on lighting) reuse one rule.
 */
export function facesComputer(
  seatCol: number,
  seatRow: number,
  facingDir: Direction,
  electronicsTiles: Set<string>,
): boolean {
  const dCol = facingDir === Direction.RIGHT ? 1 : facingDir === Direction.LEFT ? -1 : 0;
  const dRow = facingDir === Direction.DOWN ? 1 : facingDir === Direction.UP ? -1 : 0;

  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    const tileCol = seatCol + dCol * d;
    const tileRow = seatRow + dRow * d;
    if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
    // Side offset: perpendicular to facing direction, ±1.
    if (dCol !== 0) {
      if (
        electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
        electronicsTiles.has(`${tileCol},${tileRow + 1}`)
      ) {
        return true;
      }
    } else {
      if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Build the set of "col,row" tile keys covered by every electronics-category item. */
export function collectElectronicsTiles(
  furniture: Array<{ type: string; col: number; row: number }>,
  getCategory: (type: string) => string | undefined,
  getFootprint: (type: string) => { footprintW: number; footprintH: number } | null,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    if (getCategory(item.type) !== 'electronics') continue;
    const fp = getFootprint(item.type);
    if (!fp) continue;
    for (let dr = 0; dr < fp.footprintH; dr++) {
      for (let dc = 0; dc < fp.footprintW; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }
  return tiles;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webview-ui && npm test`

Expected: PASS — all 6 new tests green.

- [ ] **Step 5: Replace the inline adjacency logic in `officeState.ts`**

In `webview-ui/src/office/engine/officeState.ts`, add this import near the top (alongside the existing imports from `./characters.js`):

```typescript
import { collectElectronicsTiles, facesComputer } from './seatAdjacency.js';
```

Then replace the body of `findFreeSeat` (lines 177-233). The old implementation rebuilt the electronics-tile set and hand-rolled the adjacency math inline. Replace the whole method with:

```typescript
  private findFreeSeat(): string | null {
    const electronicsTiles = collectElectronicsTiles(
      this.layout.furniture,
      (type) => getCatalogEntry(type)?.category,
      (type) => {
        const e = getCatalogEntry(type);
        return e ? { footprintW: e.footprintW, footprintH: e.footprintH } : null;
      },
    );

    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;
      const isWork = facesComputer(seat.seatCol, seat.seatRow, seat.facingDir, electronicsTiles);
      (isWork ? pcSeats : otherSeats).push(uid);
    }

    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }
```

Also replace the inline side-offset math inside `rebuildFurnitureInstances` (lines 581-612). Find the block that builds `autoOnTiles` from every active character's seat and facing direction. Replace the entire pass (from the `for (const ch of this.characters.values()) { ... }` that builds `autoOnTiles` down through the two side-offset inner loops that add `autoOnTiles` entries, but _not_ the later "apply to furniture" loop) with:

```typescript
// Collect tiles where active agents face desks (computer adjacency window).
const autoOnTiles = new Set<string>();
for (const ch of this.characters.values()) {
  if (!ch.isActive || !ch.workSeatId) continue;
  const seat = this.seats.get(ch.workSeatId);
  if (!seat) continue;
  const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
  const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    autoOnTiles.add(`${seat.seatCol + dCol * d},${seat.seatRow + dRow * d}`);
  }
  for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
    const baseCol = seat.seatCol + dCol * d;
    const baseRow = seat.seatRow + dRow * d;
    if (dCol !== 0) {
      autoOnTiles.add(`${baseCol},${baseRow - 1}`);
      autoOnTiles.add(`${baseCol},${baseRow + 1}`);
    } else {
      autoOnTiles.add(`${baseCol - 1},${baseRow}`);
      autoOnTiles.add(`${baseCol + 1},${baseRow}`);
    }
  }
}
```

The key change inside that loop is `ch.seatId` → `ch.workSeatId`. (Side and facing math is already what `facesComputer` encapsulates, but here the caller needs the _tiles_, not a boolean, so we keep the loop — it mirrors `facesComputer` exactly.)

- [ ] **Step 6: Run tests to verify nothing regressed**

Run: `cd webview-ui && npm test` and also: `npm run test:server`

Expected: PASS.

Note: the webview tree will still have type errors because `ch.workSeatId` is referenced but `Character.seatId` consumers elsewhere haven't migrated. Those get fixed in Tasks 4-6. Type check runs at the end of Task 6.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/engine/seatAdjacency.ts \
        webview-ui/src/office/engine/officeState.ts \
        webview-ui/test/seat-classification.test.ts
git commit -m "refactor(office): extract facesComputer helper, use in seat scanning

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Classify seats as 'work' or 'rest' in `layoutToSeats`

**Files:**

- Modify: `webview-ui/src/office/layout/layoutSerializer.ts:165-231`
- Test: `webview-ui/test/seat-classification.test.ts` (append)

- [ ] **Step 1: Append failing tests for role classification**

Append to `webview-ui/test/seat-classification.test.ts`:

```typescript
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.ts';
import { layoutToSeats } from '../src/office/layout/layoutSerializer.ts';

/** Build a minimal in-memory catalog for tests (bypasses asset loading). */
function installTestCatalog() {
  buildDynamicCatalog({
    catalog: [
      {
        id: 'DESK',
        name: 'Desk',
        label: 'Desk',
        category: 'desks',
        file: 'desk.png',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: true,
        canPlaceOnWalls: false,
      },
      {
        id: 'MONITOR',
        name: 'Monitor',
        label: 'Monitor',
        category: 'electronics',
        file: 'monitor.png',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        canPlaceOnWalls: false,
        canPlaceOnSurfaces: true,
      },
      {
        id: 'CHAIR_FRONT',
        name: 'Chair',
        label: 'Chair',
        category: 'chairs',
        file: 'chair.png',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        canPlaceOnWalls: false,
        orientation: 'front', // front = facing DOWN
      },
      {
        id: 'COUCH',
        name: 'Couch',
        label: 'Couch',
        category: 'chairs',
        file: 'couch.png',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        isDesk: false,
        canPlaceOnWalls: false,
        orientation: 'front',
      },
    ],
    sprites: {
      DESK: [['#000000']],
      MONITOR: [['#000000']],
      CHAIR_FRONT: [['#000000']],
      COUCH: [['#000000', '#000000']],
    },
  });
}

test('layoutToSeats: chair facing computer on desk is a work seat', () => {
  installTestCatalog();
  // Chair at (5,5) facing DOWN. Desk at (5,6). Monitor on the desk at (5,6).
  const seats = layoutToSeats([
    { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
    { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
    { uid: 'monitor-1', type: 'MONITOR', col: 5, row: 6 },
  ]);
  const seat = seats.get('chair-1');
  assert.ok(seat);
  assert.equal(seat.role, 'work');
});

test('layoutToSeats: chair facing bare desk (no computer) is a rest seat', () => {
  installTestCatalog();
  const seats = layoutToSeats([
    { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
    { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
  ]);
  const seat = seats.get('chair-1');
  assert.ok(seat);
  assert.equal(seat.role, 'rest');
});

test('layoutToSeats: standalone couch produces only rest seats', () => {
  installTestCatalog();
  const seats = layoutToSeats([{ uid: 'couch-1', type: 'COUCH', col: 3, row: 3 }]);
  // 2-tile couch → seats 'couch-1' and 'couch-1:1'
  const a = seats.get('couch-1');
  const b = seats.get('couch-1:1');
  assert.ok(a && b);
  assert.equal(a.role, 'rest');
  assert.equal(b.role, 'rest');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webview-ui && npm test`

Expected: FAIL — `seat.role` is `undefined` until we add the classification.

- [ ] **Step 3: Implement classification in `layoutToSeats`**

In `webview-ui/src/office/layout/layoutSerializer.ts`, add this import near the top alongside the other imports:

```typescript
import { collectElectronicsTiles, facesComputer } from '../engine/seatAdjacency.js';
```

Then replace the body of `layoutToSeats` (the whole function starting at `export function layoutToSeats(...)`). Add a prelude that collects electronics tiles, and pass role to each `seats.set` call:

```typescript
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>();

  // Build set of all desk tiles (for facing-direction fallback).
  const deskTiles = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || !entry.isDesk) continue;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }

  // Build set of all electronics tiles (for work/rest classification).
  const electronicsTiles = collectElectronicsTiles(
    furniture,
    (type) => getCatalogEntry(type)?.category,
    (type) => {
      const e = getCatalogEntry(type);
      return e ? { footprintW: e.footprintW, footprintH: e.footprintH } : null;
    },
  );

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP },
    { dc: 0, dr: 1, facing: Direction.DOWN },
    { dc: -1, dr: 0, facing: Direction.LEFT },
    { dc: 1, dr: 0, facing: Direction.RIGHT },
  ];

  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || entry.category !== 'chairs') continue;

    let seatCount = 0;
    const bgRows = entry.backgroundTiles ?? 0;
    for (let dr = bgRows; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc;
        const tileRow = item.row + dr;

        let facingDir: Direction = Direction.DOWN;
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation);
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing;
              break;
            }
          }
        }

        const role: 'work' | 'rest' = facesComputer(tileCol, tileRow, facingDir, electronicsTiles)
          ? 'work'
          : 'rest';

        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`;
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          role,
          assigned: false,
        });
        seatCount++;
      }
    }
  }

  return seats;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webview-ui && npm test`

Expected: PASS — all three new classification tests green, existing tests untouched.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/layout/layoutSerializer.ts \
        webview-ui/test/seat-classification.test.ts
git commit -m "feat(office): classify seats as work/rest in layoutToSeats

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Migrate `seatId` → `workSeatId` in OfficeState and consumers

**Files:**

- Modify: `webview-ui/src/office/engine/officeState.ts` (all `ch.seatId` usages)
- Modify: `webview-ui/src/office/engine/characters.ts:49-90` (createCharacter signature)
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts` (saveAgentSeats, addAgent callsites)

- [ ] **Step 1: Update `createCharacter` signature**

In `webview-ui/src/office/engine/characters.ts`, change the `createCharacter` function. Replace the existing signature and body (lines 49-90) with:

```typescript
export function createCharacter(
  id: number,
  palette: number,
  workSeatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    workSeatId,
    restSeatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}
```

- [ ] **Step 2: Update OfficeState to use `workSeatId`**

In `webview-ui/src/office/engine/officeState.ts`, perform these exact replacements:

In `rebuildFromLayout` (around lines 90-128): replace every `ch.seatId` reference. Pattern: the first pass tries to keep existing seat assignments. Replace the whole "first pass" and "second pass" loops with this block (keeping the surrounding `rebuildFromLayout` function intact):

```typescript
// First pass: try to keep characters at their existing work seats
for (const ch of this.characters.values()) {
  if (ch.workSeatId && this.seats.has(ch.workSeatId)) {
    const seat = this.seats.get(ch.workSeatId)!;
    if (!seat.assigned && seat.role === 'work') {
      seat.assigned = true;
      ch.tileCol = seat.seatCol;
      ch.tileRow = seat.seatRow;
      const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      ch.x = cx;
      ch.y = cy;
      ch.dir = seat.facingDir;
      continue;
    }
  }
  ch.workSeatId = null; // will be reassigned below
  ch.restSeatId = null; // rest seats never persist across rebuilds
}

// Second pass: assign remaining characters to free work seats
for (const ch of this.characters.values()) {
  if (ch.workSeatId) continue;
  const seatId = this.findFreeWorkSeat();
  if (seatId) {
    this.seats.get(seatId)!.assigned = true;
    ch.workSeatId = seatId;
    const seat = this.seats.get(seatId)!;
    ch.tileCol = seat.seatCol;
    ch.tileRow = seat.seatRow;
    ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
    ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
    ch.dir = seat.facingDir;
  }
}

// Relocate any characters that ended up outside bounds or on non-walkable tiles
for (const ch of this.characters.values()) {
  if (ch.workSeatId) continue;
  if (ch.tileCol < 0 || ch.tileCol >= layout.cols || ch.tileRow < 0 || ch.tileRow >= layout.rows) {
    this.relocateCharacterToWalkable(ch);
  }
}
```

Replace `ownSeatKey` (lines 161-166):

```typescript
  private ownSeatKey(ch: Character): string | null {
    if (!ch.workSeatId) return null;
    const seat = this.seats.get(ch.workSeatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }
```

Replace the body of `findFreeSeat` (the version you last edited in Task 3) with a work-seat-only picker. Rest seats are picked ad-hoc by the FSM in Task 6, not from here.

```typescript
  private findFreeWorkSeat(): string | null {
    const free: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;
      if (seat.role !== 'work') continue;
      free.push(uid);
    }
    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)];
  }
```

In `addAgent` (lines 263-327), change `this.findFreeSeat()` to `this.findFreeWorkSeat()` and rename every `seatId` local variable / `ch.seatId` assignment to `ch.workSeatId`:

```typescript
  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    terminalName?: string,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first (must still be a work seat), then any free work seat.
    let workSeatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      if (!seat.assigned && seat.role === 'work') {
        workSeatId = preferredSeatId;
      }
    }
    if (!workSeatId) {
      workSeatId = this.findFreeWorkSeat();
    }

    let ch: Character;
    if (workSeatId) {
      const seat = this.seats.get(workSeatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, workSeatId, seat, hueShift);
    } else {
      // No work seats — spawn at random walkable tile; character will wander.
      const spawn =
        this.walkableTiles.length > 0
          ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
          : { col: 1, row: 1 };
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (folderName) {
      ch.folderName = folderName;
    }
    if (terminalName) {
      ch.terminalName = terminalName;
    }
    if (!skipSpawnEffect) {
      ch.matrixEffect = 'spawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
    }
    this.characters.set(id, ch);
  }
```

In `removeAgent` (lines 329-345), replace `ch.seatId` with `ch.workSeatId`, and also free any rest-seat occupation:

```typescript
  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return;
    if (ch.workSeatId) {
      const seat = this.seats.get(ch.workSeatId);
      if (seat) seat.assigned = false;
    }
    if (ch.restSeatId) {
      const rest = this.seats.get(ch.restSeatId);
      if (rest) rest.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    ch.matrixEffect = 'despawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();
    ch.bubbleType = null;
  }
```

In `reassignSeat` (lines 356-389), gate on `seat.role === 'work'` and use `workSeatId`:

```typescript
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    // Only work seats can be user-assigned; clicking a rest seat is a no-op.
    if (seat.role !== 'work') return;

    if (ch.workSeatId) {
      const old = this.seats.get(ch.workSeatId);
      if (old) old.assigned = false;
    }
    seat.assigned = true;
    ch.workSeatId = seatId;

    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }
```

In `sendToSeat` (lines 392-416), replace `ch.seatId` with `ch.workSeatId`:

```typescript
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.workSeatId) return;
    const seat = this.seats.get(ch.workSeatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }
```

In `removeSubagent` and `removeAllSubagents` (both free the seat on removal), replace `ch.seatId` with `ch.workSeatId`. Subagents don't get rest seats, so no `restSeatId` cleanup is needed there.

- [ ] **Step 3: Update `useExtensionMessages.ts` save path**

In `webview-ui/src/hooks/useExtensionMessages.ts`, replace the `saveAgentSeats` helper (lines 72-79):

```typescript
function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; workSeatId: string | null }> =
    {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, workSeatId: ch.workSeatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}
```

In the `existingAgents` handler (around lines 216-245), the `meta` type and destructure read `seatId`. Update to read whichever field is present (extension sends `workSeatId` after Task 8; during rollout, old saved data still has `seatId`):

```typescript
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string; workSeatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        const terminalNames = (msg.terminalNames || {}) as Record<number, string>;
        for (const id of incoming) {
          const m = meta[id];
          pendingAgents.push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.workSeatId ?? m?.seatId,
            folderName: folderNames[id],
            terminalName: terminalNames[id],
          });
        }
        setAgents((prev) => {
          // ... unchanged
```

The `pendingAgents` buffer type above (in the outer `useEffect`, lines 114-121) still uses `seatId` as the internal field name — keep it; it's passed to `os.addAgent(..., preferredSeatId, ...)` which is still `seatId`-named. The remapping happens once here.

- [ ] **Step 4: Run tests**

Run: `cd webview-ui && npm test`

Expected: PASS — all seat-classification tests still green.

Note: **do not run `npm run build` yet**. The type checker will still fail because `characters.ts` has unreferenced `ch.seatId` reads inside `updateCharacter` that Task 6 will fix. The runtime tests pass because the classification test file only imports `layoutSerializer.ts` + `seatAdjacency.ts`, which are already consistent.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/engine/officeState.ts \
        webview-ui/src/office/engine/characters.ts \
        webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "refactor(office): migrate seatId → workSeatId; split work/rest seat pickers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: FSM — rest-seat behavior when idle

**Files:**

- Modify: `webview-ui/src/office/engine/characters.ts` (updateCharacter: IDLE and WALK states)

- [ ] **Step 1: Replace the IDLE-state wander-then-rest block**

In `webview-ui/src/office/engine/characters.ts`, find the `case CharacterState.IDLE` block (roughly lines 125-211). Replace its body with the version below. Key changes:

- When `isActive` → pathfind to `workSeatId` (was `seatId`).
- When wander budget expires and a rest seat is free → walk to it (was: go back to the work seat).
- Otherwise wander.
- Clear `restSeatId` whenever the character leaves a rest seat.

```typescript
    case CharacterState.IDLE: {
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0;

      // If became active, pathfind to work seat
      if (ch.isActive) {
        // Free any rest seat we were occupying so other idle characters can use it.
        if (ch.restSeatId) {
          const rest = seats.get(ch.restSeatId);
          if (rest) rest.assigned = false;
          ch.restSeatId = null;
        }
        if (!ch.workSeatId) {
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.workSeatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }

      // Idle: countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Wander budget expired: try to claim a rest seat instead of going back to a computer.
        if (ch.wanderCount >= ch.wanderLimit && !ch.restSeatId) {
          const restUid = findNearestFreeRestSeat(ch, seats);
          if (restUid) {
            const rest = seats.get(restUid)!;
            rest.assigned = true;
            ch.restSeatId = restUid;
            const path = findPath(
              ch.tileCol,
              ch.tileRow,
              rest.seatCol,
              rest.seatRow,
              tileMap,
              blockedTiles,
            );
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
            // No path — release the claim and fall through to wander.
            rest.assigned = false;
            ch.restSeatId = null;
          }
        }

        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }
```

- [ ] **Step 2: Add the `findNearestFreeRestSeat` helper**

At the bottom of `webview-ui/src/office/engine/characters.ts`, below `randomInt`, add:

```typescript
function findNearestFreeRestSeat(ch: Character, seats: Map<string, Seat>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [uid, seat] of seats) {
    if (seat.assigned) continue;
    if (seat.role !== 'rest') continue;
    const dist = Math.abs(seat.seatCol - ch.tileCol) + Math.abs(seat.seatRow - ch.tileRow);
    if (dist < bestDist) {
      bestDist = dist;
      best = uid;
    }
  }
  return best;
}
```

- [ ] **Step 3: Update the WALK-state arrival handler**

Still in `characters.ts`, replace the `case CharacterState.WALK` body's "Path complete" block (roughly lines 220-268) with this. Changes:

- Uses `workSeatId` not `seatId`.
- Recognizes arrival at a rest seat: sit down (TYPE + static pose via Task 7), no wander reset.
- Recognizes arrival at work seat while `isActive`: normal type/read behavior.
- The legacy "arrived at old seatId while !isActive, start rest timer, reset wanderCount" branch is removed — rest-seat arrival replaces it.

```typescript
if (ch.path.length === 0) {
  const center = tileCenter(ch.tileCol, ch.tileRow);
  ch.x = center.x;
  ch.y = center.y;

  if (ch.isActive) {
    // Active arrival: work seat → TYPE, otherwise type-in-place or IDLE.
    if (!ch.workSeatId) {
      ch.state = CharacterState.TYPE;
    } else {
      const seat = seats.get(ch.workSeatId);
      if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
        ch.state = CharacterState.TYPE;
        ch.dir = seat.facingDir;
      } else {
        ch.state = CharacterState.IDLE;
      }
    }
  } else if (ch.restSeatId) {
    // Idle arrival at a claimed rest seat → sit.
    const rest = seats.get(ch.restSeatId);
    if (rest && ch.tileCol === rest.seatCol && ch.tileRow === rest.seatRow) {
      ch.state = CharacterState.TYPE;
      ch.dir = rest.facingDir;
      // Reset wander budget so we sit for a while before roaming again.
      ch.wanderCount = 0;
      ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
    } else {
      // We lost the rest seat during travel (shouldn't usually happen).
      if (rest) rest.assigned = false;
      ch.restSeatId = null;
      ch.state = CharacterState.IDLE;
    }
  } else {
    ch.state = CharacterState.IDLE;
    ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
  }
  ch.frame = 0;
  ch.frameTimer = 0;
  break;
}
```

The rest of the WALK case (step-by-step movement, tile center interpolation, repath-on-active) is unchanged EXCEPT the repath block at the bottom. Replace its `ch.seatId` references with `ch.workSeatId`:

```typescript
// If became active while wandering, repath to work seat
if (ch.isActive && ch.workSeatId) {
  const seat = seats.get(ch.workSeatId);
  if (seat) {
    const lastStep = ch.path[ch.path.length - 1];
    if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
      // Free rest-seat claim if we had one — we're diverting to the desk.
      if (ch.restSeatId) {
        const rest = seats.get(ch.restSeatId);
        if (rest) rest.assigned = false;
        ch.restSeatId = null;
      }
      const newPath = findPath(
        ch.tileCol,
        ch.tileRow,
        seat.seatCol,
        seat.seatRow,
        tileMap,
        blockedTiles,
      );
      if (newPath.length > 0) {
        ch.path = newPath;
        ch.moveProgress = 0;
      }
    }
  }
}
break;
```

- [ ] **Step 4: Update the TYPE-state `!isActive` exit**

In the TYPE case (around lines 103-123), when the character is seated at a work seat and becomes inactive, they currently stand up after `seatTimer`. That's still correct. But if they're at a rest seat and become active, they need to leave. Add a block that detects being at a rest seat + active:

Replace the TYPE case body:

```typescript
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }

      // If on a rest seat and became active, pathfind to work seat.
      if (ch.isActive && ch.restSeatId) {
        const rest = seats.get(ch.restSeatId);
        if (rest) rest.assigned = false;
        ch.restSeatId = null;
        // Fall through to IDLE which will immediately pathfind to workSeatId.
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Existing: if no longer active, stand up and start wandering.
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0;
        // If we're at a rest seat, we can stay — only leave if !isActive was just set.
        // A rest-seated character stays seated until they become active again.
        if (ch.restSeatId) {
          break;
        }
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }
```

- [ ] **Step 5: Type check**

Run: `cd webview-ui && npm run build`

Expected: PASS — FSM compiles and ties together with the types introduced earlier.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/office/engine/characters.ts
git commit -m "feat(office): idle characters claim rest seats instead of returning to desks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Static pose when seated on a rest seat

**Files:**

- Modify: `webview-ui/src/office/engine/characters.ts:319-333` (getCharacterSprite)

- [ ] **Step 1: Update `getCharacterSprite`**

Replace the existing function body:

```typescript
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      // Resting seated (on a couch) or idle at work seat: static pose.
      if (!ch.isActive) {
        return sprites.walk[ch.dir][1];
      }
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}
```

- [ ] **Step 2: Type check & build**

Run: `cd webview-ui && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/engine/characters.ts
git commit -m "feat(office): static pose when seated but not active

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Overlay — "Thinking…" label when active without an active tool

**Files:**

- Modify: `webview-ui/src/office/components/ToolOverlay.tsx:41-63`

- [ ] **Step 1: Update `getActivityText`**

In `webview-ui/src/office/components/ToolOverlay.tsx`, replace the `getActivityText` function:

```typescript
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    if (isActive) {
      // Mid-turn with no in-flight tool: agent is thinking (or outputting text).
      return 'Thinking…';
    }
  }

  if (isActive) return 'Thinking…';
  return 'Idle';
}
```

The subtle diff: the `if (isActive) { return lastTool.status; }` branch is replaced with `'Thinking…'` (so the label no longer clings to the last tool once that tool finishes mid-turn), and the fallback path also checks `isActive` so text-only turns (never had any tool at all) show "Thinking…" too.

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/components/ToolOverlay.tsx
git commit -m "feat(office): hover label shows 'Thinking…' when active with no tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Extension persistence — accept `workSeatId`, migrate from `seatId`

**Files:**

- Modify: `src/agentManager.ts:534-537` (sendExistingAgents meta read)

- [ ] **Step 1: Update the persisted-meta type to accept both fields**

In `src/agentManager.ts`, locate the `sendExistingAgents` function (around line 522). Replace this block:

```typescript
// Include persisted palette/seatId from separate key
const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(
  WORKSPACE_KEY_AGENT_SEATS,
  {},
);
```

with:

```typescript
// Include persisted palette + work-seat from separate key.
// Legacy records may still carry a `seatId` field from before the workSeatId split.
const rawAgentMeta = context.workspaceState.get<
  Record<string, { palette?: number; hueShift?: number; seatId?: string; workSeatId?: string }>
>(WORKSPACE_KEY_AGENT_SEATS, {});
const agentMeta: Record<string, { palette?: number; hueShift?: number; workSeatId?: string }> = {};
for (const [id, m] of Object.entries(rawAgentMeta)) {
  agentMeta[id] = {
    palette: m.palette,
    hueShift: m.hueShift,
    workSeatId: m.workSeatId ?? m.seatId,
  };
}
```

The `webview.postMessage({ type: 'existingAgents', ..., agentMeta, ... })` call below is unchanged — it passes through the now-migrated `agentMeta`.

- [ ] **Step 2: Verify**

Run the full build/test matrix:

```bash
npm run build
npm run test:server
cd webview-ui && npm test && cd ..
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/agentManager.ts
git commit -m "refactor(persistence): migrate persisted seatId → workSeatId on send

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` — the `Seats` paragraph and the `Condensed Lessons` / `Asset System` sections.

- [ ] **Step 1: Update the Seats paragraph**

In `CLAUDE.md`, find the paragraph that begins "**Seats**: Derived from chair furniture." (around line 135). Replace it with:

```markdown
**Seats**: Derived from chair furniture. `layoutToSeats()` creates a seat at every footprint tile of every chair and assigns a `role: 'work' | 'rest'`. A seat is `'work'` when its tile faces a computer — a furniture item of category `electronics` — within the same adjacency window used by auto-state (`AUTO_ON_FACING_DEPTH` tiles deep × 1 tile to each side, via `facesComputer()` in `engine/seatAdjacency.ts`). All other chairs (couches, loungers, chairs at empty desks) are `'rest'`. Multi-tile chairs (e.g. 2-tile couches) produce multiple seats keyed `uid` / `uid:1` / `uid:2`. Facing direction priority: 1) chair `orientation` from catalog (front→DOWN, back→UP, left→LEFT, right→RIGHT), 2) adjacent desk direction, 3) forward (DOWN). Click character → select (white outline) → click available **work seat** to reassign (rest seats are ignored for user reassignment; they're a shared pool picked ad-hoc).
```

- [ ] **Step 2: Add a note on work/rest behavior in the Characters paragraph**

Find the paragraph that begins "**Characters**: FSM states — active (pathfind to seat…" (around line 125). Replace up through the end of the first sentence pair with:

```markdown
**Characters**: FSM states — active (pathfind to **work seat**, typing/reading animation by tool type), idle (wander randomly with BFS; once `wanderLimit` is reached, claim the nearest free **rest seat** — a couch or lounger — instead of returning to the desk). `isActive` flips true on `UserPromptSubmit` (hooks mode) or on first tool use (heuristic mode fallback); flips false on `Stop` / `turn_duration`. While seated but not active (resting on a couch, or briefly lingering before standing up), the character renders in a static pose (no typing/reading animation).
```

- [ ] **Step 3: Add one line to the Condensed Lessons section**

Find the bullet list under `## Condensed Lessons` (around line 186). Add at the end:

```markdown
- **Work vs rest seats**: position carries meaning. Character at a work seat (chair facing a computer) ⇒ working/thinking. Wandering or at a rest seat (couch) ⇒ idle. The overlay's "Thinking…" label derives from `isActive && no active tool`; position does the heavy visual lifting
```

- [ ] **Step 4: Note limitation on external asset packs under Asset System**

Find the `**Catalog**` paragraph (around line 161). At the end of that paragraph, append one sentence:

```markdown
Note: the work/rest seat rule keys off `category === 'electronics'`. External asset packs that ship monitors/computers under a different category won't classify those chairs as work seats; re-categorize via `asset-manager.html`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe work/rest seat classification and isActive lifecycle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full build + test matrix:**

```bash
npm run build
npm run test:server
cd webview-ui && npm test && npm run build && cd ..
```

Expected: all green.

- [ ] **Manual verification in a real VS Code Extension Dev Host (F5):**
  1. Open an existing workspace with a decorated layout. Observe that no character is sitting at a computer while idle — they're either wandering or on a couch.
  2. Submit a prompt to one agent. Character walks to desk; hover label reads `Thinking…` until the first tool fires.
  3. Submit a text-only prompt. Label stays `Thinking…` until `Stop` arrives, then character stands up, wanders, eventually moves to a free rest seat.
  4. Temporarily remove every computer from your layout. Submit prompts — characters never leave wander-mode; hover label still reads `Thinking…` during active state.
  5. Click an agent, then click a work seat (chair with a monitor in front): reassignment works. Click a couch: nothing happens.

- [ ] **Any anomaly → open a bug thread; do not ship.**
