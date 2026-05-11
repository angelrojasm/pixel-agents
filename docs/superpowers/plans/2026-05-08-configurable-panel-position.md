# Configurable Panel Position + Terminal Font Size — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `panelPosition` (`bottom` / `left` / `right`) and `terminalFontSize` settings, with the lite-rail following the panel's edge. SettingsModal exposes both. All changes per-webview, persisted via `vscode.setState`.

**Architecture:** Refactor the existing `webview-ui/src/office/drawer/` subtree to be axis-aware (still no `vscode` imports — Phase-3 compatible). Layout math is generalized from a height-only band into `computePanelBand({ position, viewportW, viewportH }) → { mode, bandSize, canvasW, canvasH }`. Outer App layout flips between `flex-direction: column` (bottom) and `row` (sides).

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, no enums), React 19, Vite, `node:test` for unit tests. No new dependencies.

---

## Preconditions

Work on `feature/character-name-labels` (current branch — already has the Phase-2 drawer shell + awaiting-user changes uncommitted; this builds on top). No new branch required for this iteration.

The `drawer/` subtree is being **renamed to `panel/`** as part of this plan. The existing tests under `webview-ui/test/drawer-*.test.ts` get renamed to `panel-*.test.ts` to match.

---

## File Structure

**Renamed (move existing files):**

| From                                                | To                                                        |
| --------------------------------------------------- | --------------------------------------------------------- |
| `webview-ui/src/office/drawer/drawerTypes.ts`       | `webview-ui/src/office/panel/panelTypes.ts`               |
| `webview-ui/src/office/drawer/drawerLayout.ts`      | `webview-ui/src/office/panel/panelLayout.ts`              |
| `webview-ui/src/office/drawer/drawerState.ts`       | `webview-ui/src/office/panel/panelState.ts`               |
| `webview-ui/src/office/drawer/drawerPersistence.ts` | `webview-ui/src/office/panel/panelPersistence.ts`         |
| `webview-ui/src/office/drawer/useDrawerState.ts`    | `webview-ui/src/office/panel/usePanelState.ts`            |
| `webview-ui/src/office/drawer/BottomDrawer.tsx`     | `webview-ui/src/office/panel/OfficePanel.tsx`             |
| `webview-ui/src/office/drawer/DrawerHeader.tsx`     | `webview-ui/src/office/panel/PanelHeader.tsx`             |
| `webview-ui/src/office/drawer/LiteRail.tsx`         | `webview-ui/src/office/panel/LiteRail.tsx` (kept)         |
| `webview-ui/src/office/drawer/RailPeek.tsx`         | `webview-ui/src/office/panel/RailPeek.tsx` (kept)         |
| `webview-ui/src/office/drawer/AgentCell.tsx`        | `webview-ui/src/office/panel/AgentCell.tsx` (kept)        |
| `webview-ui/src/office/drawer/TerminalPaneStub.tsx` | `webview-ui/src/office/panel/TerminalPaneStub.tsx` (kept) |
| `webview-ui/test/drawer-layout.test.ts`             | `webview-ui/test/panel-layout.test.ts`                    |
| `webview-ui/test/drawer-state.test.ts`              | `webview-ui/test/panel-state.test.ts`                     |

After renames, `webview-ui/src/office/drawer/` no longer exists.

**Modified:**

| File                                          | Change                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `webview-ui/src/constants.ts`                 | Add side-axis sizes, `MIN_PANEL_VIEWPORT_PX_HORIZONTAL`, font-size bounds         |
| `webview-ui/src/App.tsx`                      | Outer flex-direction follows `panelPosition`; child order flips for left vs right |
| `webview-ui/src/components/SettingsModal.tsx` | Add panel-position radio + terminal-font-size input                               |

---

## Task 1: Move and rename `drawer/` → `panel/`

**Files:** see file-structure renames above.

Pure mechanical rename. Internal symbols (`DrawerState`, `BottomDrawer`, `useDrawerState`, etc.) get renamed to `Panel*` / `OfficePanel` / `usePanelState`. The persisted JSON key stays `drawerOpen` for backwards-compat (handled in Task 4).

- [ ] **Step 1: Move files (preserves git history)**

```bash
cd /Users/angel/Desktop/pixel-agents
mkdir -p webview-ui/src/office/panel
git mv webview-ui/src/office/drawer/drawerTypes.ts webview-ui/src/office/panel/panelTypes.ts
git mv webview-ui/src/office/drawer/drawerLayout.ts webview-ui/src/office/panel/panelLayout.ts
git mv webview-ui/src/office/drawer/drawerState.ts webview-ui/src/office/panel/panelState.ts
git mv webview-ui/src/office/drawer/drawerPersistence.ts webview-ui/src/office/panel/panelPersistence.ts
git mv webview-ui/src/office/drawer/useDrawerState.ts webview-ui/src/office/panel/usePanelState.ts
git mv webview-ui/src/office/drawer/BottomDrawer.tsx webview-ui/src/office/panel/OfficePanel.tsx
git mv webview-ui/src/office/drawer/DrawerHeader.tsx webview-ui/src/office/panel/PanelHeader.tsx
git mv webview-ui/src/office/drawer/LiteRail.tsx webview-ui/src/office/panel/LiteRail.tsx
git mv webview-ui/src/office/drawer/RailPeek.tsx webview-ui/src/office/panel/RailPeek.tsx
git mv webview-ui/src/office/drawer/AgentCell.tsx webview-ui/src/office/panel/AgentCell.tsx
git mv webview-ui/src/office/drawer/TerminalPaneStub.tsx webview-ui/src/office/panel/TerminalPaneStub.tsx
git mv webview-ui/test/drawer-layout.test.ts webview-ui/test/panel-layout.test.ts
git mv webview-ui/test/drawer-state.test.ts webview-ui/test/panel-state.test.ts
rmdir webview-ui/src/office/drawer
```

If `git mv` fails because some files weren't tracked (the drawer work is uncommitted), just use `mv` for those and `git add` the new locations once the renames settle.

- [ ] **Step 2: Rename internal symbols**

Inside the moved files and their importers, rename:

- `DrawerState` → `PanelState`
- `DrawerPersistedState` → `PanelPersistedState`
- `DrawerMode` → `PanelMode`
- `DrawerApi` → `PanelApi`
- `BottomDrawer` (component name) → `OfficePanel`
- `DrawerHeader` (component) → `PanelHeader`
- `useDrawerState` → `usePanelState`
- `loadDrawerState` / `saveDrawerState` → `loadPanelState` / `savePanelState`
- `drawerOpen` (state field) → `panelOpen` (the persisted JSON key remains `drawerOpen` — see Task 4)
- Constants imported from `'./drawerLayout.js'` → `'./panelLayout.js'`, etc.
- Test file imports update to the new paths.

This is mechanical search-and-replace. After renames, the existing 22 drawer-state + drawer-layout tests still describe the same logic — they just reference renamed symbols.

- [ ] **Step 3: Update App.tsx imports**

In `webview-ui/src/App.tsx`:

```ts
// before
import { BottomDrawer } from './office/drawer/BottomDrawer.js';
import type { AgentSummary } from './office/drawer/drawerTypes.js';
import { useDrawerState } from './office/drawer/useDrawerState.js';

// after
import { OfficePanel } from './office/panel/OfficePanel.js';
import type { AgentSummary } from './office/panel/panelTypes.js';
import { usePanelState } from './office/panel/usePanelState.js';
```

Variable rename `drawer` → `panel` in `App()`:

```ts
const panel = usePanelState(containerRef, editor.isEditMode);
```

And update all `drawer.*` references to `panel.*`.

JSX rename:

```tsx
<OfficePanel
  agents={agentSummaries}
  state={panel.state}
  band={panel.band}
  onFocusAgent={handleClick}
  onCollapse={panel.collapse}
  onToggleRailHidden={panel.toggleRailHidden}
/>
```

- [ ] **Step 4: Build + tests still green**

```bash
cd webview-ui && npx tsc -b --noEmit && npm test
```

Expected: type-check passes, 22 panel tests still pass (same logic, renamed identifiers).

---

## Task 2: New constants

**Files:**

- Modify: `webview-ui/src/constants.ts`

- [ ] **Step 1: Append the panel-position section**

Find the existing `// ── Bottom Drawer (Phase 2 UX shell)` block. Replace its contents (drawer-only) with axis-aware constants:

```ts
// ── Office Panel (Phase 2 UX shell, configurable position) ───
/** Bottom panel sizing. */
export const PANEL_BOTTOM_OPEN_RATIO = 0.4; // fraction of viewport height
export const PANEL_BOTTOM_OPEN_MAX_PX = 320;
export const PANEL_BOTTOM_RAIL_PX = 28;
export const PANEL_BOTTOM_PEEK_PX = 6;
/** Side (left/right) panel sizing. */
export const PANEL_SIDE_OPEN_RATIO = 0.4; // fraction of viewport width
export const PANEL_SIDE_OPEN_MAX_PX = 360;
export const PANEL_SIDE_RAIL_PX = 32;
export const PANEL_SIDE_PEEK_PX = 6;
/** Viewport-floor checks per axis. */
export const MIN_PANEL_VIEWPORT_PX_VERTICAL = 360; // bottom panel needs this much height
export const MIN_PANEL_VIEWPORT_PX_HORIZONTAL = 480; // side panel needs this much width
/** Panel header (focused-agent frame + tab strip + actions) thickness. */
export const PANEL_HEADER_THICKNESS_PX = 22;

/** Terminal font size (xterm.js will consume the same value once D2 lands). */
export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 24;

// Panel chrome colors (centralized — file is exempt from no-inline-colors).
export const PANEL_BG_CHROME = '#0a0a14';
export const PANEL_BG_CELL = '#1e1e2e';
export const PANEL_BORDER = '#4a4a6e';
export const PANEL_ACCENT = '#4ade80';
export const PANEL_MUTED = '#6b7280';
export const PANEL_WAITING = '#f59e0b';
export const PANEL_SPRITE_PLACEHOLDER = '#f5c2a7';
```

Replace the old drawer-named constant exports (`DRAWER_HEIGHT_RATIO`, `DRAWER_HEIGHT_MAX_PX`, `RAIL_HEIGHT_PX`, `PEEK_HEIGHT_PX`, `MIN_DRAWER_VIEWPORT_PX`, `DRAWER_HEADER_HEIGHT_PX`, `DRAWER_BG_*`, `DRAWER_*`) with the panel-prefixed names. All importers (`PanelHeader.tsx`, `LiteRail.tsx`, `RailPeek.tsx`, `OfficePanel.tsx`, `AgentCell.tsx`, `TerminalPaneStub.tsx`, `panelLayout.ts`) update to the new names.

- [ ] **Step 2: Build to find any importers we missed**

```bash
cd webview-ui && npx tsc -b --noEmit
```

Fix any "Cannot find name 'DRAWER\_\*'" errors by replacing with the new names.

---

## Task 3: Types — `PanelPosition` + extend persisted state

**Files:**

- Modify: `webview-ui/src/office/panel/panelTypes.ts`

- [ ] **Step 1: Update `panelTypes.ts`**

Replace the full contents with:

```ts
/** Visual mode of the panel band. */
export const PanelMode = {
  OPEN: 'open',
  RAIL: 'rail',
  PEEK: 'peek',
} as const;
export type PanelMode = (typeof PanelMode)[keyof typeof PanelMode];

/** Where the panel docks. */
export const PanelPosition = {
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
} as const;
export type PanelPosition = (typeof PanelPosition)[keyof typeof PanelPosition];

/** True when the panel uses the horizontal axis (bottom). */
export function isHorizontalAxis(p: PanelPosition): boolean {
  return p === PanelPosition.BOTTOM;
}

/** Minimal agent view for the panel UI. */
export interface AgentSummary {
  id: number;
  name: string;
  palette: number;
  hueShift: number;
  status: 'active' | 'waiting' | 'idle';
}

/** Persisted per-webview slice. Lives in vscode.setState. */
export interface PanelPersistedState {
  panelOpen: boolean;
  railHidden: boolean;
  panelPosition: PanelPosition;
  terminalFontSize: number;
}

/** Full in-memory panel state. Only PanelPersistedState fields are persisted. */
export interface PanelState extends PanelPersistedState {
  focusedAgentId: number | null;
  isEditMode: boolean;
  /** Container width in CSS px (used for side-axis floor + open-size math). */
  viewportWidth: number;
  /** Container height in CSS px (used for bottom-axis floor + open-size math). */
  viewportHeight: number;
}
```

Note: removed `viewportHeight` solo, replaced with both `viewportWidth` and `viewportHeight`. The hook's `ResizeObserver` reads both from `el.clientWidth` / `el.clientHeight`.

---

## Task 4: Refactor `panelLayout.ts` (TDD)

**Files:**

- Modify: `webview-ui/src/office/panel/panelLayout.ts`
- Modify: `webview-ui/test/panel-layout.test.ts`

The new `computePanelBand` returns a `Band` object with both `canvasW` and `canvasH` (instead of `canvasHeight`).

- [ ] **Step 1: Replace tests with axis-aware coverage**

Overwrite `webview-ui/test/panel-layout.test.ts` with:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_PANEL_VIEWPORT_PX_HORIZONTAL,
  MIN_PANEL_VIEWPORT_PX_VERTICAL,
  PANEL_BOTTOM_OPEN_MAX_PX,
  PANEL_BOTTOM_OPEN_RATIO,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_SIDE_OPEN_MAX_PX,
  PANEL_SIDE_OPEN_RATIO,
  PANEL_SIDE_PEEK_PX,
  PANEL_SIDE_RAIL_PX,
} from '../src/constants.ts';
import { computePanelBand } from '../src/office/panel/panelLayout.ts';
import type { PanelState } from '../src/office/panel/panelTypes.ts';
import { PanelMode, PanelPosition } from '../src/office/panel/panelTypes.ts';

function baseState(over: Partial<PanelState> = {}): PanelState {
  return {
    panelOpen: false,
    railHidden: false,
    panelPosition: PanelPosition.BOTTOM,
    terminalFontSize: 14,
    focusedAgentId: null,
    isEditMode: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    ...over,
  };
}

test('bottom: closed + rail visible → bottom rail; canvas fills width', () => {
  const b = computePanelBand(baseState());
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_BOTTOM_RAIL_PX);
  assert.equal(b.canvasW, 1280);
  assert.equal(b.canvasH, 800 - PANEL_BOTTOM_RAIL_PX);
});

test('bottom: closed + rail hidden → bottom peek', () => {
  const b = computePanelBand(baseState({ railHidden: true }));
  assert.equal(b.mode, PanelMode.PEEK);
  assert.equal(b.bandSize, PANEL_BOTTOM_PEEK_PX);
});

test('bottom: open + adequate viewport → drawer band height', () => {
  const b = computePanelBand(baseState({ panelOpen: true }));
  assert.equal(b.mode, PanelMode.OPEN);
  const expected = Math.min(Math.round(800 * PANEL_BOTTOM_OPEN_RATIO), PANEL_BOTTOM_OPEN_MAX_PX);
  assert.equal(b.bandSize, expected);
  assert.equal(b.canvasW, 1280);
  assert.equal(b.canvasH, 800 - expected);
});

test('bottom: open + tall viewport caps at MAX', () => {
  const b = computePanelBand(baseState({ panelOpen: true, viewportHeight: 2000 }));
  assert.equal(b.bandSize, PANEL_BOTTOM_OPEN_MAX_PX);
});

test('bottom: open + height under floor → forced to rail', () => {
  const short = MIN_PANEL_VIEWPORT_PX_VERTICAL - 10;
  const b = computePanelBand(baseState({ panelOpen: true, viewportHeight: short }));
  assert.equal(b.mode, PanelMode.RAIL);
});

test('left: closed + rail visible → side rail; canvas loses width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT }));
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasW, 1280 - PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasH, 800);
});

test('right: closed + rail visible → side rail; canvas loses width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.RIGHT }));
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasW, 1280 - PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasH, 800);
});

test('left: closed + rail hidden → side peek', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT, railHidden: true }));
  assert.equal(b.mode, PanelMode.PEEK);
  assert.equal(b.bandSize, PANEL_SIDE_PEEK_PX);
});

test('left: open + adequate viewport → side band width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT, panelOpen: true }));
  assert.equal(b.mode, PanelMode.OPEN);
  const expected = Math.min(Math.round(1280 * PANEL_SIDE_OPEN_RATIO), PANEL_SIDE_OPEN_MAX_PX);
  assert.equal(b.bandSize, expected);
  assert.equal(b.canvasW, 1280 - expected);
  assert.equal(b.canvasH, 800);
});

test('right: open + wide viewport caps at side MAX', () => {
  const b = computePanelBand(
    baseState({ panelPosition: PanelPosition.RIGHT, panelOpen: true, viewportWidth: 4000 }),
  );
  assert.equal(b.bandSize, PANEL_SIDE_OPEN_MAX_PX);
});

test('left: open + width under horizontal floor → forced to rail', () => {
  const narrow = MIN_PANEL_VIEWPORT_PX_HORIZONTAL - 10;
  const b = computePanelBand(
    baseState({ panelPosition: PanelPosition.LEFT, panelOpen: true, viewportWidth: narrow }),
  );
  assert.equal(b.mode, PanelMode.RAIL);
});

test('left: open + width under floor + railHidden → forced to peek', () => {
  const narrow = MIN_PANEL_VIEWPORT_PX_HORIZONTAL - 10;
  const b = computePanelBand(
    baseState({
      panelPosition: PanelPosition.LEFT,
      panelOpen: true,
      railHidden: true,
      viewportWidth: narrow,
    }),
  );
  assert.equal(b.mode, PanelMode.PEEK);
});

test('edit mode forces rail regardless of panelOpen, in any position', () => {
  for (const p of [PanelPosition.BOTTOM, PanelPosition.LEFT, PanelPosition.RIGHT]) {
    const b = computePanelBand(baseState({ panelPosition: p, panelOpen: true, isEditMode: true }));
    assert.equal(b.mode, PanelMode.RAIL, `position ${p}`);
  }
});

test('canvas dimensions never negative', () => {
  const b = computePanelBand(baseState({ viewportWidth: 0, viewportHeight: 0 }));
  assert.equal(b.canvasW >= 0, true);
  assert.equal(b.canvasH >= 0, true);
});
```

- [ ] **Step 2: Run tests, watch them fail**

```bash
cd webview-ui && npm test
```

Expected: many failures (old `computeBand` signature mismatch).

- [ ] **Step 3: Replace `panelLayout.ts`**

Overwrite with:

```ts
import {
  MIN_PANEL_VIEWPORT_PX_HORIZONTAL,
  MIN_PANEL_VIEWPORT_PX_VERTICAL,
  PANEL_BOTTOM_OPEN_MAX_PX,
  PANEL_BOTTOM_OPEN_RATIO,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_SIDE_OPEN_MAX_PX,
  PANEL_SIDE_OPEN_RATIO,
  PANEL_SIDE_PEEK_PX,
  PANEL_SIDE_RAIL_PX,
} from '../../constants.js';
import type { PanelState } from './panelTypes.js';
import { PanelMode, PanelPosition, isHorizontalAxis } from './panelTypes.js';

export interface Band {
  mode: PanelMode;
  /** Thickness of the panel band along its axis (height for bottom, width for sides). */
  bandSize: number;
  /** Remaining canvas width in CSS px. */
  canvasW: number;
  /** Remaining canvas height in CSS px. */
  canvasH: number;
}

function bottomOpenSize(viewportHeight: number): number {
  return Math.min(Math.round(viewportHeight * PANEL_BOTTOM_OPEN_RATIO), PANEL_BOTTOM_OPEN_MAX_PX);
}

function sideOpenSize(viewportWidth: number): number {
  return Math.min(Math.round(viewportWidth * PANEL_SIDE_OPEN_RATIO), PANEL_SIDE_OPEN_MAX_PX);
}

function collapsedBottom(railHidden: boolean): { mode: PanelMode; bandSize: number } {
  return railHidden
    ? { mode: PanelMode.PEEK, bandSize: PANEL_BOTTOM_PEEK_PX }
    : { mode: PanelMode.RAIL, bandSize: PANEL_BOTTOM_RAIL_PX };
}

function collapsedSide(railHidden: boolean): { mode: PanelMode; bandSize: number } {
  return railHidden
    ? { mode: PanelMode.PEEK, bandSize: PANEL_SIDE_PEEK_PX }
    : { mode: PanelMode.RAIL, bandSize: PANEL_SIDE_RAIL_PX };
}

export function computePanelBand(state: PanelState): Band {
  const { panelOpen, railHidden, isEditMode, panelPosition, viewportWidth, viewportHeight } = state;

  const horizontal = isHorizontalAxis(panelPosition); // true when panel is on the BOTTOM
  const dimAlong = horizontal ? viewportHeight : viewportWidth;
  const floor = horizontal ? MIN_PANEL_VIEWPORT_PX_VERTICAL : MIN_PANEL_VIEWPORT_PX_HORIZONTAL;
  const forceCollapsed = isEditMode || dimAlong < floor;
  const effectivelyOpen = panelOpen && !forceCollapsed;

  let mode: PanelMode;
  let bandSize: number;
  if (effectivelyOpen) {
    mode = PanelMode.OPEN;
    bandSize = horizontal ? bottomOpenSize(viewportHeight) : sideOpenSize(viewportWidth);
  } else {
    const collapsed = horizontal ? collapsedBottom(railHidden) : collapsedSide(railHidden);
    mode = collapsed.mode;
    bandSize = collapsed.bandSize;
  }

  const canvasW = horizontal ? viewportWidth : Math.max(0, viewportWidth - bandSize);
  const canvasH = horizontal ? Math.max(0, viewportHeight - bandSize) : viewportHeight;

  return { mode, bandSize, canvasW, canvasH };
}

/** Convenience: which side is the panel on, used by JSX flex-order decisions. */
export function panelOnLeading(panelPosition: PanelPosition): boolean {
  return panelPosition === PanelPosition.LEFT;
}

export { PanelPosition, isHorizontalAxis };
```

- [ ] **Step 4: Tests pass**

```bash
npm test
```

Expected: all panel-layout tests pass.

---

## Task 5: Update `panelState.ts` reducers

**Files:**

- Modify: `webview-ui/src/office/panel/panelState.ts`
- Modify: `webview-ui/test/panel-state.test.ts`

The existing reducers already operate on `PanelState`. We add two new ones for the new fields plus update the existing tests' base state to include `panelPosition` + `terminalFontSize` + `viewportWidth`.

- [ ] **Step 1: Add `setPanelPosition` and `setTerminalFontSize`**

Append to `panelState.ts`:

```ts
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../../constants.js';
import type { PanelPosition, PanelState } from './panelTypes.js';

export function setPanelPosition(state: PanelState, position: PanelPosition): PanelState {
  return state.panelPosition === position ? state : { ...state, panelPosition: position };
}

export function setTerminalFontSize(state: PanelState, size: number): PanelState {
  const clamped = Math.max(
    TERMINAL_FONT_SIZE_MIN,
    Math.min(TERMINAL_FONT_SIZE_MAX, Math.round(size)),
  );
  return state.terminalFontSize === clamped ? state : { ...state, terminalFontSize: clamped };
}

export function setViewportWidth(state: PanelState, viewportWidth: number): PanelState {
  return state.viewportWidth === viewportWidth ? state : { ...state, viewportWidth };
}
```

(Imports for `TERMINAL_FONT_SIZE_*` go at the top with the existing imports.)

- [ ] **Step 2: Update test base state**

In `panel-state.test.ts`, update `baseState` to include the new fields (the existing tests don't need new test cases for this task, just compile with the new shape):

```ts
function baseState(over: Partial<PanelState> = {}): PanelState {
  return {
    panelOpen: false,
    railHidden: false,
    panelPosition: PanelPosition.BOTTOM,
    terminalFontSize: 14,
    focusedAgentId: null,
    isEditMode: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    ...over,
  };
}
```

Add at top:

```ts
import { PanelPosition } from '../src/office/panel/panelTypes.ts';
```

- [ ] **Step 3: Add tests for new reducers**

Append to `panel-state.test.ts`:

```ts
import { setPanelPosition, setTerminalFontSize } from '../src/office/panel/panelState.ts';

test('setPanelPosition: switching position is reflected in state', () => {
  const next = setPanelPosition(baseState(), PanelPosition.LEFT);
  assert.equal(next.panelPosition, PanelPosition.LEFT);
});

test('setPanelPosition: same position returns the same object (no change)', () => {
  const s = baseState({ panelPosition: PanelPosition.LEFT });
  const next = setPanelPosition(s, PanelPosition.LEFT);
  assert.strictEqual(next, s);
});

test('setTerminalFontSize: clamps to allowed range', () => {
  const tooSmall = setTerminalFontSize(baseState(), 5);
  assert.equal(tooSmall.terminalFontSize, 10);
  const tooBig = setTerminalFontSize(baseState(), 100);
  assert.equal(tooBig.terminalFontSize, 24);
  const ok = setTerminalFontSize(baseState(), 16);
  assert.equal(ok.terminalFontSize, 16);
});

test('setTerminalFontSize: rounds non-integers', () => {
  const next = setTerminalFontSize(baseState(), 14.6);
  assert.equal(next.terminalFontSize, 15);
});
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all panel-layout + panel-state tests pass.

---

## Task 6: Update `panelPersistence.ts` (translation layer)

**Files:**

- Modify: `webview-ui/src/office/panel/panelPersistence.ts`

The persisted JSON keeps the legacy `drawerOpen` key (no migration burden). The two new fields are stored under their own names. Defaults handle missing fields.

- [ ] **Step 1: Replace contents**

```ts
import { TERMINAL_FONT_SIZE_DEFAULT } from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import type { PanelPersistedState } from './panelTypes.js';
import { PanelPosition } from './panelTypes.js';

const STATE_KEY = 'pixelAgents.drawer'; // legacy key name retained for backwards-compat

interface PersistedShape {
  /** Legacy name retained on disk; in-memory we use `panelOpen`. */
  drawerOpen?: boolean;
  railHidden?: boolean;
  panelPosition?: PanelPosition;
  terminalFontSize?: number;
}

interface RootShape {
  [STATE_KEY]?: PersistedShape;
}

const DEFAULT: PanelPersistedState = {
  panelOpen: false,
  railHidden: false,
  panelPosition: PanelPosition.BOTTOM,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
};

function isPanelPosition(v: unknown): v is PanelPosition {
  return v === 'bottom' || v === 'left' || v === 'right';
}

export function loadPanelState(): PanelPersistedState {
  const raw = vscode.getState<RootShape>();
  const slice = raw?.[STATE_KEY];
  if (!slice || typeof slice !== 'object') return DEFAULT;
  return {
    panelOpen: !!slice.drawerOpen,
    railHidden: !!slice.railHidden,
    panelPosition: isPanelPosition(slice.panelPosition)
      ? slice.panelPosition
      : DEFAULT.panelPosition,
    terminalFontSize:
      typeof slice.terminalFontSize === 'number' && Number.isFinite(slice.terminalFontSize)
        ? slice.terminalFontSize
        : DEFAULT.terminalFontSize,
  };
}

export function savePanelState(state: PanelPersistedState): void {
  const prev = vscode.getState<RootShape>() ?? {};
  const slice: PersistedShape = {
    drawerOpen: state.panelOpen,
    railHidden: state.railHidden,
    panelPosition: state.panelPosition,
    terminalFontSize: state.terminalFontSize,
  };
  vscode.setState({ ...prev, [STATE_KEY]: slice });
}
```

---

## Task 7: Update `usePanelState.ts` hook

**Files:**

- Modify: `webview-ui/src/office/panel/usePanelState.ts`

- [ ] **Step 1: Replace contents**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { computePanelBand } from './panelLayout.js';
import { loadPanelState, savePanelState } from './panelPersistence.js';
import {
  closeAgent as closeAgentReducer,
  focusOrToggle as focusOrToggleReducer,
  setEditMode as setEditModeReducer,
  setPanelPosition as setPanelPositionReducer,
  setTerminalFontSize as setTerminalFontSizeReducer,
  setViewportHeight as setViewportHeightReducer,
  setViewportWidth as setViewportWidthReducer,
  toggleRailHidden as toggleRailHiddenReducer,
} from './panelState.js';
import type { PanelPosition, PanelState } from './panelTypes.js';

export interface PanelApi {
  state: PanelState;
  band: ReturnType<typeof computePanelBand>;
  focusOrToggle(agentId: number): void;
  openForNewAgent(agentId: number): void;
  closeAgent(closedId: number, mostRecentOtherAgentId: number | null): void;
  toggleRailHidden(): void;
  collapse(): void;
  setPanelPosition(p: PanelPosition): void;
  setTerminalFontSize(n: number): void;
}

export function usePanelState(
  containerRef: RefObject<HTMLElement | null>,
  isEditMode: boolean,
): PanelApi {
  const initial = useMemo<PanelState>(() => {
    const persisted = loadPanelState();
    return {
      ...persisted,
      focusedAgentId: null,
      isEditMode,
      viewportWidth:
        typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280,
      viewportHeight:
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial state only
  }, []);

  const [state, setState] = useState<PanelState>(initial);

  const lastPersistedRef = useRef({
    panelOpen: initial.panelOpen,
    railHidden: initial.railHidden,
    panelPosition: initial.panelPosition,
    terminalFontSize: initial.terminalFontSize,
  });
  useEffect(() => {
    const { panelOpen, railHidden, panelPosition, terminalFontSize } = state;
    const last = lastPersistedRef.current;
    if (
      last.panelOpen !== panelOpen ||
      last.railHidden !== railHidden ||
      last.panelPosition !== panelPosition ||
      last.terminalFontSize !== terminalFontSize
    ) {
      savePanelState({ panelOpen, railHidden, panelPosition, terminalFontSize });
      lastPersistedRef.current = { panelOpen, railHidden, panelPosition, terminalFontSize };
    }
  }, [state]);

  useEffect(() => {
    setState((s) => (s.isEditMode === isEditMode ? s : setEditModeReducer(s, isEditMode)));
  }, [isEditMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (w: number, h: number) =>
      setState((s) => {
        const next1 = s.viewportWidth === w ? s : setViewportWidthReducer(s, w);
        const next2 = next1.viewportHeight === h ? next1 : setViewportHeightReducer(next1, h);
        return next2;
      });
    update(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const focusOrToggle = useCallback((agentId: number) => {
    setState((s) => focusOrToggleReducer(s, agentId));
  }, []);

  const openForNewAgent = useCallback((agentId: number) => {
    setState((s) => ({ ...s, panelOpen: true, focusedAgentId: agentId }));
  }, []);

  const closeAgent = useCallback((closedId: number, mostRecentOtherAgentId: number | null) => {
    setState((s) => closeAgentReducer(s, closedId, mostRecentOtherAgentId));
  }, []);

  const toggleRailHidden = useCallback(() => {
    setState((s) => toggleRailHiddenReducer(s));
  }, []);

  const collapse = useCallback(() => {
    setState((s) => (s.panelOpen ? { ...s, panelOpen: false } : s));
  }, []);

  const setPanelPosition = useCallback((p: PanelPosition) => {
    setState((s) => setPanelPositionReducer(s, p));
  }, []);

  const setTerminalFontSize = useCallback((n: number) => {
    setState((s) => setTerminalFontSizeReducer(s, n));
  }, []);

  const band = useMemo(() => computePanelBand(state), [state]);

  return {
    state,
    band,
    focusOrToggle,
    openForNewAgent,
    closeAgent,
    toggleRailHidden,
    collapse,
    setPanelPosition,
    setTerminalFontSize,
  };
}
```

---

## Task 8: `AgentCell` rail-side variant

**Files:**

- Modify: `webview-ui/src/office/panel/AgentCell.tsx`

- [ ] **Step 1: Add `rail-side` variant**

Replace the SIZES table to include the new variant, and adjust layout for it (square cell, sprite + status dot only, no name text):

```tsx
import {
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BORDER,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
  PANEL_WAITING,
} from '../../constants.js';
import type { AgentSummary } from './panelTypes.js';

interface AgentCellProps {
  agent: AgentSummary;
  variant: 'rail' | 'rail-side' | 'tab';
  isFocused: boolean;
  onClick: () => void;
}

const SIZES = {
  rail: { width: 72, height: 20, fontSize: 10 },
  'rail-side': { width: 24, height: 24, fontSize: 0 }, // sprite + dot only
  tab: { width: 56, height: 16, fontSize: 9 },
} as const;

const STATUS_COLOR: Record<AgentSummary['status'], string> = {
  active: PANEL_ACCENT,
  waiting: PANEL_WAITING,
  idle: PANEL_MUTED,
};

export function AgentCell({ agent, variant, isFocused, onClick }: AgentCellProps) {
  const { width, height, fontSize } = SIZES[variant];
  const borderColor = isFocused ? PANEL_ACCENT : PANEL_BORDER;
  const isSquare = variant === 'rail-side';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width,
        height,
        background: PANEL_BG_CELL,
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isSquare ? 'center' : 'flex-start',
        gap: isSquare ? 0 : 4,
        padding: isSquare ? 0 : '0 4px',
        cursor: 'pointer',
        fontSize,
        position: 'relative',
      }}
      title={agent.name}
    >
      <span
        aria-hidden
        style={{
          width: isSquare ? 10 : 6,
          height: isSquare ? 12 : 8,
          background: PANEL_SPRITE_PLACEHOLDER,
          flex: '0 0 auto',
        }}
      />
      {!isSquare && (
        <span
          style={{
            color: isFocused ? PANEL_ACCENT : PANEL_MUTED,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: '1 1 auto',
            textAlign: 'left',
          }}
        >
          {agent.name}
        </span>
      )}
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 0,
          background: STATUS_COLOR[agent.status],
          flex: '0 0 auto',
          position: isSquare ? 'absolute' : 'static',
          top: isSquare ? 2 : undefined,
          right: isSquare ? 2 : undefined,
        }}
      />
    </button>
  );
}
```

---

## Task 9: `LiteRail` axis-aware

**Files:**

- Modify: `webview-ui/src/office/panel/LiteRail.tsx`

- [ ] **Step 1: Replace contents**

```tsx
import {
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_MUTED,
  PANEL_SIDE_RAIL_PX,
} from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface LiteRailProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  panelPosition: PanelPosition;
  onFocusAgent: (id: number) => void;
  onHideRail: () => void;
}

export function LiteRail({
  agents,
  focusedAgentId,
  panelPosition,
  onFocusAgent,
  onHideRail,
}: LiteRailProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  const variant = horizontal ? 'rail' : 'rail-side';

  return (
    <div
      style={{
        ...(horizontal
          ? {
              height: PANEL_BOTTOM_RAIL_PX,
              borderTop: `2px solid ${PANEL_BORDER}`,
              flexDirection: 'row',
            }
          : {
              width: PANEL_SIDE_RAIL_PX,
              borderLeft: panelPosition === 'right' ? `2px solid ${PANEL_BORDER}` : undefined,
              borderRight: panelPosition === 'left' ? `2px solid ${PANEL_BORDER}` : undefined,
              flexDirection: 'column',
            }),
        background: PANEL_BG_CHROME,
        display: 'flex',
        alignItems: 'center',
        gap: horizontal ? 6 : 4,
        padding: horizontal ? '0 8px' : '6px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: 'center',
          gap: horizontal ? 6 : 4,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {agents.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant={variant}
            isFocused={a.id === focusedAgentId}
            onClick={() => onFocusAgent(a.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onHideRail}
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: horizontal ? 10 : 9,
          cursor: 'pointer',
          padding: horizontal ? '0 4px' : '4px 0',
          writingMode: horizontal ? 'horizontal-tb' : 'vertical-rl',
        }}
        title="Hide rail"
      >
        [hide]
      </button>
    </div>
  );
}
```

---

## Task 10: `RailPeek` axis-aware

**Files:**

- Modify: `webview-ui/src/office/panel/RailPeek.tsx`

- [ ] **Step 1: Replace contents**

```tsx
import {
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_SIDE_PEEK_PX,
} from '../../constants.js';
import type { PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface RailPeekProps {
  panelPosition: PanelPosition;
  onRestore: () => void;
}

export function RailPeek({ panelPosition, onRestore }: RailPeekProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label="Show rail"
      title="Show rail"
      style={{
        ...(horizontal
          ? { height: PANEL_BOTTOM_PEEK_PX, width: '100%', borderTop: `2px solid ${PANEL_BORDER}` }
          : {
              width: PANEL_SIDE_PEEK_PX,
              height: '100%',
              borderLeft: panelPosition === 'right' ? `2px solid ${PANEL_BORDER}` : undefined,
              borderRight: panelPosition === 'left' ? `2px solid ${PANEL_BORDER}` : undefined,
            }),
        background: PANEL_BG_CHROME,
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
```

---

## Task 11: `PanelHeader` axis-aware

**Files:**

- Modify: `webview-ui/src/office/panel/PanelHeader.tsx`

The header gains a `panelPosition` prop. In horizontal mode it's the existing top strip; in vertical mode it becomes a top-of-column strip with the same children stacked vertically.

- [ ] **Step 1: Replace contents**

```tsx
import {
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_HEADER_THICKNESS_PX,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
} from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface PanelHeaderProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  panelPosition: PanelPosition;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
}

export function PanelHeader({
  agents,
  focusedAgentId,
  panelPosition,
  onFocusAgent,
  onCollapse,
}: PanelHeaderProps) {
  const focused = agents.find((a) => a.id === focusedAgentId) ?? null;
  const others = agents.filter((a) => a.id !== focusedAgentId);
  const horizontal = isHorizontalAxis(panelPosition);
  const collapseLabel = horizontal
    ? '[↓ hide]'
    : panelPosition === 'left'
      ? '[← hide]'
      : '[→ hide]';

  return (
    <div
      style={{
        ...(horizontal
          ? {
              height: PANEL_HEADER_THICKNESS_PX,
              flexDirection: 'row',
              borderTop: `2px solid ${PANEL_BORDER}`,
            }
          : {
              width: '100%',
              flexDirection: 'column',
              borderBottom: `2px solid ${PANEL_BORDER}`,
            }),
        background: PANEL_BG_CHROME,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
      }}
    >
      {focused && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 6px',
            border: `1px solid ${PANEL_ACCENT}`,
            height: 16,
            background: PANEL_BG_CELL,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 10,
              background: PANEL_SPRITE_PLACEHOLDER,
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: PANEL_ACCENT, fontSize: 10 }}>{focused.name}</span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: 'center',
          gap: 4,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {others.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant={horizontal ? 'tab' : 'rail-side'}
            isFocused={false}
            onClick={() => onFocusAgent(a.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onCollapse}
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 4px',
        }}
        title="Hide panel"
      >
        {collapseLabel}
      </button>
    </div>
  );
}
```

---

## Task 12: `OfficePanel` shell

**Files:**

- Modify: `webview-ui/src/office/panel/OfficePanel.tsx`

The shell:

- Sizes itself by the relevant axis (height for bottom, width for sides) using `band.bandSize`.
- Forwards `panelPosition` to children (`LiteRail`, `RailPeek`, `PanelHeader`).
- Passes `terminalFontSize` to `TerminalPaneStub`.

- [ ] **Step 1: Replace contents**

```tsx
import { PANEL_HEADER_THICKNESS_PX } from '../../constants.js';
import type { Band } from './panelLayout.js';
import { PanelHeader } from './PanelHeader.js';
import { PanelMode } from './panelTypes.js';
import type { AgentSummary, PanelState } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';
import { LiteRail } from './LiteRail.js';
import { RailPeek } from './RailPeek.js';
import { TerminalPaneStub } from './TerminalPaneStub.js';

interface OfficePanelProps {
  agents: AgentSummary[];
  state: PanelState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
}

export function OfficePanel({
  agents,
  state,
  band,
  onFocusAgent,
  onCollapse,
  onToggleRailHidden,
}: OfficePanelProps) {
  const focused = agents.find((a) => a.id === state.focusedAgentId) ?? null;
  const horizontal = isHorizontalAxis(state.panelPosition);

  // Outer dimensions: bottom panel uses height, sides use width.
  const outerStyle = horizontal
    ? { height: band.bandSize, flex: `0 0 ${band.bandSize}px` }
    : { width: band.bandSize, flex: `0 0 ${band.bandSize}px`, height: '100%' };

  if (band.mode === PanelMode.PEEK) {
    return (
      <div style={outerStyle}>
        <RailPeek panelPosition={state.panelPosition} onRestore={onToggleRailHidden} />
      </div>
    );
  }

  if (band.mode === PanelMode.RAIL) {
    return (
      <div style={outerStyle}>
        <LiteRail
          agents={agents}
          focusedAgentId={state.focusedAgentId}
          panelPosition={state.panelPosition}
          onFocusAgent={onFocusAgent}
          onHideRail={onToggleRailHidden}
        />
      </div>
    );
  }

  // OPEN: header + terminal area (split along the panel's primary axis).
  // Bottom panel: header on top of terminal (column flex). Side panel: header on
  // top of terminal too (column flex), but the panel itself is a column anyway.
  return (
    <div
      style={{
        ...outerStyle,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PanelHeader
        agents={agents}
        focusedAgentId={state.focusedAgentId}
        panelPosition={state.panelPosition}
        onFocusAgent={onFocusAgent}
        onCollapse={onCollapse}
      />
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TerminalPaneStub
          agentId={state.focusedAgentId}
          agentName={focused?.name ?? null}
          fontSize={state.terminalFontSize}
        />
      </div>
    </div>
  );
}
```

Note: header is placed at the top in both axes. For sides, this is a top-of-column header strip. Keeping the header dimension fixed (`PANEL_HEADER_THICKNESS_PX`) regardless of axis simplifies the model — it's always "top of the panel chrome." For users with a left/right panel, the header is the topmost strip of the panel column.

---

## Task 13: `TerminalPaneStub` font-size prop

**Files:**

- Modify: `webview-ui/src/office/panel/TerminalPaneStub.tsx`

- [ ] **Step 1: Replace contents**

```tsx
import { PANEL_ACCENT, PANEL_BG_CHROME, PANEL_MUTED } from '../../constants.js';

interface TerminalPaneStubProps {
  agentId: number | null;
  agentName: string | null;
  fontSize: number;
}

export function TerminalPaneStub({ agentId, agentName, fontSize }: TerminalPaneStubProps) {
  if (agentId == null) {
    return (
      <div
        style={{
          flex: '1 1 auto',
          background: PANEL_BG_CHROME,
          color: PANEL_MUTED,
          fontSize,
          padding: 12,
        }}
      >
        No agent focused.
      </div>
    );
  }
  return (
    <div
      style={{
        flex: '1 1 auto',
        background: PANEL_BG_CHROME,
        color: PANEL_ACCENT,
        fontSize,
        padding: 12,
        overflow: 'auto',
      }}
    >
      <div>
        [ terminal stub — agent #{agentId} ({agentName ?? 'unknown'}) ]
      </div>
      <div style={{ color: PANEL_MUTED, marginTop: 4 }}>
        xterm.js will replace this stub once the pty backend (D2) lands. For now, the terminal still
        runs in VS Code&apos;s native terminal strip.
      </div>
    </div>
  );
}
```

---

## Task 14: `App.tsx` — flex direction + child order

**Files:**

- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Make flex direction follow `panelPosition`**

Find the outer container in the render. Replace:

```tsx
return (
  <div
    ref={containerRef}
    className="w-full h-full overflow-hidden"
    style={{ display: 'flex', flexDirection: 'column' }}
  >
    <div
      ref={canvasAreaRef}
      style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}
    >
      <OfficeCanvas …/>
      … {/* other floating UI inside canvas area */}
    </div>
    <OfficePanel …/>
  </div>
);
```

with a position-aware version that places the panel before or after the canvas area depending on `state.panelPosition`:

```tsx
const panelPos = panel.state.panelPosition;
const flexDirection: 'row' | 'column' = panelPos === 'bottom' ? 'column' : 'row';
const panelFirst = panelPos === 'left'; // panel goes BEFORE canvas in left mode

const canvasArea = (
  <div
    ref={canvasAreaRef}
    style={{ flex: '1 1 auto', position: 'relative', minWidth: 0, minHeight: 0 }}
  >
    {/* existing canvas-area children — OfficeCanvas, ZoomControls, vignette, EditActionBar,
        showRotateHint, EditorToolbar, ToolOverlay, DebugView, Tooltip, hooks Modal,
        BottomToolbar, VersionIndicator, ChangelogModal, SettingsModal, MigrationNotice */}
  </div>
);

const panelEl = (
  <OfficePanel
    agents={agentSummaries}
    state={panel.state}
    band={panel.band}
    onFocusAgent={handleClick}
    onCollapse={panel.collapse}
    onToggleRailHidden={panel.toggleRailHidden}
  />
);

return (
  <div
    ref={containerRef}
    className="w-full h-full overflow-hidden"
    style={{ display: 'flex', flexDirection }}
  >
    {panelFirst ? panelEl : canvasArea}
    {panelFirst ? canvasArea : panelEl}
  </div>
);
```

The `minWidth: 0` on the canvas area is important for side mode — without it, the canvas area's intrinsic width would push the panel off-screen.

`SettingsModal` is rendered inside the canvas area (it's already there in the current App.tsx). The `panel.setPanelPosition` and `panel.setTerminalFontSize` callbacks are passed into `SettingsModal` so the user can change them.

- [ ] **Step 2: Pass new callbacks to SettingsModal**

In the `<SettingsModal …/>` JSX inside the canvas area, add:

```tsx
panelPosition={panel.state.panelPosition}
onChangePanelPosition={panel.setPanelPosition}
terminalFontSize={panel.state.terminalFontSize}
onChangeTerminalFontSize={panel.setTerminalFontSize}
```

These props will be added to the SettingsModal component in the next task.

---

## Task 15: `SettingsModal` — new controls

**Files:**

- Modify: `webview-ui/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add the two new props to the component**

Find the props interface and add:

```ts
panelPosition: 'bottom' | 'left' | 'right';
onChangePanelPosition: (p: 'bottom' | 'left' | 'right') => void;
terminalFontSize: number;
onChangeTerminalFontSize: (n: number) => void;
```

(Match the literal union in the existing PanelPosition type rather than introducing a stringly-typed alias; the file already uses lots of literal unions.)

- [ ] **Step 2: Render the controls**

Inside the existing settings sections (style-match the existing radios/inputs in the file), add a "Panel Position" section with three radio options and a "Terminal Font Size" section with a number input + ± buttons. Place after the existing layout/sound/hooks sections, before any save/close action row.

Concrete JSX (assuming the file uses the same Tailwind + pixel-panel patterns as elsewhere in the webview):

```tsx
<div className="mt-4">
  <div className="text-sm mb-2">Panel Position</div>
  <div className="flex gap-3">
    {(['bottom', 'left', 'right'] as const).map((p) => (
      <label key={p} className="flex items-center gap-1 cursor-pointer">
        <input
          type="radio"
          name="panel-position"
          value={p}
          checked={panelPosition === p}
          onChange={() => onChangePanelPosition(p)}
        />
        <span className="capitalize">{p}</span>
      </label>
    ))}
  </div>
</div>

<div className="mt-4">
  <div className="text-sm mb-2">Terminal Font Size</div>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => onChangeTerminalFontSize(terminalFontSize - 1)}
      className="px-2 border-2 border-border"
      disabled={terminalFontSize <= 10}
      title="Smaller"
    >
      –
    </button>
    <input
      type="number"
      min={10}
      max={24}
      step={1}
      value={terminalFontSize}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v)) onChangeTerminalFontSize(v);
      }}
      className="w-16 text-center border-2 border-border bg-bg-dark"
    />
    <button
      type="button"
      onClick={() => onChangeTerminalFontSize(terminalFontSize + 1)}
      className="px-2 border-2 border-border"
      disabled={terminalFontSize >= 24}
      title="Larger"
    >
      +
    </button>
    <span className="text-xs text-text-muted">px</span>
  </div>
</div>
```

If the SettingsModal uses different markup conventions, adapt the markup but keep the radio + number-with-step controls semantic structure.

---

## Task 16: Final verification

**Files:** none

- [ ] **Step 1: Type-check + lint**

```bash
cd /Users/angel/Desktop/pixel-agents/webview-ui && npx tsc -b --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 2: Tests**

```bash
npm test
```

Expected: all panel-layout (≥13 tests) + panel-state (≥26 tests) + existing tests pass.

- [ ] **Step 3: Top-level build + tests**

```bash
cd /Users/angel/Desktop/pixel-agents
npm run build
npm test
```

Expected: full build clean, 137+ tests pass.

- [ ] **Step 4: Manual verify**

- F5 dev host → Settings modal exposes Panel Position radio + Terminal Font Size input.
- Switch to Left → office canvas reflows; rail becomes a column on the left.
- Open the panel (click an agent / + Agent) → panel band on the left, canvas takes the rest of the width.
- Switch to Right → mirrors.
- Shrink window width below ~480px → panel forces to rail.
- Bump font size → stub text scales.
- Open both side panel + full-screen → each persists its own panel position.

---

## Self-Review Checklist

- [ ] All renames applied consistently (no stray `Drawer*` symbols left).
- [ ] Persisted JSON key `drawerOpen` retained for back-compat; no migration needed.
- [ ] `computePanelBand` returns `{ canvasW, canvasH }` consistently.
- [ ] `LiteRail`, `RailPeek`, `PanelHeader`, `OfficePanel` all accept `panelPosition`.
- [ ] `TerminalPaneStub` accepts `fontSize` prop.
- [ ] `App.tsx` panel-first vs canvas-first ordering correct (left = panel first; right and bottom = panel last).
- [ ] `SettingsModal` props wired in `App.tsx` to `panel.setPanelPosition` / `panel.setTerminalFontSize`.
- [ ] Tests cover: bottom/left/right × open/rail/peek (9 cases) + each axis floor + edit-mode override.

---

## Out of Scope

- Drag-to-resize the panel.
- Animated transition when switching positions.
- xterm.js integration — separate plan after D1 + D2 land.
- Per-agent panel position.
