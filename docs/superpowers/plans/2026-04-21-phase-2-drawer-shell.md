# Phase 2 Drawer Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the webview-side drawer + lite-rail UX shell described in `docs/superpowers/specs/2026-04-21-phase-2-drawer-ux-design.md`. Terminal content is a stub; xterm.js integration is a follow-up plan that depends on the `MessageSource` refactor (D1) and the `node-pty` backend (D2), neither of which exists yet.

**Architecture:** The drawer is a self-contained subtree under `webview-ui/src/office/drawer/`. All terminal-adjacent state (`drawerOpen`, `railHidden`, `focusedAgentId`, `isEditMode`, `viewportHeight`) is derived in pure modules (`drawerLayout.ts`, `drawerState.ts`) that are unit-testable with the existing `node:test` + `tsx/esm` harness. A React hook (`useDrawerState.ts`) glues those pure modules to `vscode.setState`/`getState` for per-webview persistence and a `ResizeObserver` for viewport tracking. `App.tsx` becomes a flex-column (canvas on top, drawer band on bottom); the existing `OfficeCanvas` ResizeObserver math (DPR + integer zoom) is unchanged.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, no enums — `as const` only), React 19, Vite, Tailwind v4 (already in repo), `node:test` + `node:assert/strict` via `tsx/esm` for unit tests.

---

## Preconditions

**Branch:** Work lands on a dedicated branch `feature/phase-2-drawer-shell` based off a clean `main` or off this repo's current main branch. The repo currently has unrelated in-progress work on `feature/character-name-labels`; do NOT pile onto that branch. If unclear, ask before creating commits.

**No behavior change to existing terminals:** Every agent continues to use `vscode.window.createTerminal` (legacy path). The drawer renders `TerminalPaneStub` placeholders only — no pty wiring, no xterm.js. Users still type into the VS Code terminal strip for now. This keeps the change reviewable in isolation.

**Follow-up plans (not this one):**

- D1: `MessageSource` inbound abstraction
- D2: `node-pty` backend + protocol messages
- Replace `TerminalPaneStub` with real `TerminalPane` (this happens only after D1 + D2)

---

## File Structure

**New files under `webview-ui/src/office/drawer/`:**

| File                   | Responsibility                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `drawerTypes.ts`       | `DrawerMode` union, `DrawerState`, `AgentSummary` type                                                |
| `drawerLayout.ts`      | Pure: `computeBand({ viewportHeight, state }) → { bandHeight, mode, canvasHeight }`; testable         |
| `drawerState.ts`       | Pure: `focusOrToggle`, `closeAgent`, `setViewportHeight`, `setEditMode`, `toggleRailHidden`; testable |
| `drawerPersistence.ts` | Thin wrapper around `vscode.getState/setState` for persisted slice (`drawerOpen`, `railHidden`)       |
| `useDrawerState.ts`    | React hook; orchestrates state + persistence + ResizeObserver + viewport                              |
| `AgentCell.tsx`        | Shared presentational cell; `variant: 'rail' \| 'tab'`                                                |
| `LiteRail.tsx`         | Horizontal strip of `AgentCell` + `[hide rail]` chip                                                  |
| `RailPeek.tsx`         | 6px edge-hug tab                                                                                      |
| `DrawerHeader.tsx`     | Focused-agent frame + tab strip of OTHER agents + `[↓ hide]` `[✕]` actions                            |
| `TerminalPaneStub.tsx` | Placeholder terminal content                                                                          |
| `BottomDrawer.tsx`     | Shell — renders one of {open, rail, peek} subtrees based on derived state                             |

**Modified files:**

| File                          | Change                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/constants.ts` | Add drawer constants section                                                                                     |
| `webview-ui/src/vscodeApi.ts` | Add typed `getState`/`setState` surface                                                                          |
| `webview-ui/src/App.tsx`      | Flex-column container; mount `BottomDrawer`; wire focus-on-click + `+Agent` auto-open + edit-mode force-collapse |

**New test files in `webview-ui/test/`:**

| File                    | Responsibility                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| `drawer-layout.test.ts` | Layout math across viewport sizes + modes                           |
| `drawer-state.test.ts`  | State transitions (focus-toggle, close, edit-mode, viewport-shrink) |

Tests live flat under `test/` to match the existing `node --test test/*.test.ts` glob.

---

## Task 1: Add drawer constants

**Files:**

- Modify: `webview-ui/src/constants.ts` (append to end)

- [ ] **Step 1: Append drawer constants section**

Add this block at the end of `webview-ui/src/constants.ts`:

```ts
// ── Bottom Drawer (Phase 2 UX shell) ─────────────────────────
export const DRAWER_HEIGHT_RATIO = 0.4; // fraction of viewport when open
export const DRAWER_HEIGHT_MAX_PX = 320; // upper bound on drawer height
export const RAIL_HEIGHT_PX = 28; // lite-rail band height
export const PEEK_HEIGHT_PX = 6; // edge-hug peek tab height
export const MIN_DRAWER_VIEWPORT_PX = 360; // below this, drawer force-collapses to rail
```

- [ ] **Step 2: Commit**

```bash
git add webview-ui/src/constants.ts
git commit -m "chore(webview): add drawer layout constants"
```

---

## Task 2: Add typed `getState`/`setState` to vscodeApi

**Files:**

- Modify: `webview-ui/src/vscodeApi.ts`

The existing module exposes only `postMessage`. Drawer persistence needs `getState` and `setState` exposed through the same typed surface.

- [ ] **Step 1: Rewrite vscodeApi.ts with full VSCodeApi surface**

Replace the file contents with:

```ts
import { isBrowserRuntime } from './runtime';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
};

export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
}

const browserFallback: VSCodeApi = {
  postMessage: (msg: unknown) => console.log('[vscode.postMessage]', msg),
  getState: () => undefined,
  setState: (state) => state,
};

export const vscode: VSCodeApi = isBrowserRuntime
  ? browserFallback
  : (acquireVsCodeApi() as VSCodeApi);
```

- [ ] **Step 2: Build to make sure nothing broke**

Run: `cd webview-ui && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/vscodeApi.ts
git commit -m "feat(webview): expose typed getState/setState on vscode api"
```

---

## Task 3: Drawer types

**Files:**

- Create: `webview-ui/src/office/drawer/drawerTypes.ts`

- [ ] **Step 1: Create the types file**

Write the following to `webview-ui/src/office/drawer/drawerTypes.ts`:

```ts
/** Visual mode of the bottom band. */
export const DrawerMode = {
  OPEN: 'open',
  RAIL: 'rail',
  PEEK: 'peek',
} as const;
export type DrawerMode = (typeof DrawerMode)[keyof typeof DrawerMode];

/** Minimal agent view for the drawer UI. */
export interface AgentSummary {
  id: number;
  name: string;
  /** Palette index, used by AgentCell to show the sprite color. */
  palette: number;
  /** Hue shift in degrees (0 for the first 6 palettes). */
  hueShift: number;
  /** Tool/activity status glyph color hint. */
  status: 'active' | 'waiting' | 'idle';
}

/** Persisted per-webview slice. Lives in vscode.setState. */
export interface DrawerPersistedState {
  drawerOpen: boolean;
  railHidden: boolean;
}

/** Full in-memory drawer state. Only DrawerPersistedState is persisted. */
export interface DrawerState extends DrawerPersistedState {
  focusedAgentId: number | null;
  /** True when edit mode is active. Overrides the visual to rail/peek. */
  isEditMode: boolean;
  /** Current viewport height in CSS px. Below MIN_DRAWER_VIEWPORT_PX, band is forced. */
  viewportHeight: number;
}
```

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/drawer/drawerTypes.ts
git commit -m "feat(webview): add drawer type definitions"
```

---

## Task 4: Drawer layout math (TDD)

**Files:**

- Create: `webview-ui/src/office/drawer/drawerLayout.ts`
- Test: `webview-ui/test/drawer-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `webview-ui/test/drawer-layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DRAWER_HEIGHT_MAX_PX,
  DRAWER_HEIGHT_RATIO,
  MIN_DRAWER_VIEWPORT_PX,
  PEEK_HEIGHT_PX,
  RAIL_HEIGHT_PX,
} from '../src/constants.ts';
import { computeBand } from '../src/office/drawer/drawerLayout.ts';
import { DrawerMode } from '../src/office/drawer/drawerTypes.ts';
import type { DrawerState } from '../src/office/drawer/drawerTypes.ts';

function baseState(over: Partial<DrawerState> = {}): DrawerState {
  return {
    drawerOpen: false,
    railHidden: false,
    focusedAgentId: null,
    isEditMode: false,
    viewportHeight: 800,
    ...over,
  };
}

test('computeBand: closed + rail visible → rail band', () => {
  const band = computeBand(baseState({ drawerOpen: false, railHidden: false }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
  assert.equal(band.canvasHeight, 800 - RAIL_HEIGHT_PX);
});

test('computeBand: closed + rail hidden → peek band', () => {
  const band = computeBand(baseState({ drawerOpen: false, railHidden: true }));
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
  assert.equal(band.canvasHeight, 800 - PEEK_HEIGHT_PX);
});

test('computeBand: open + adequate viewport → drawer band', () => {
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: 800 }));
  assert.equal(band.mode, DrawerMode.OPEN);
  const expected = Math.min(Math.round(800 * DRAWER_HEIGHT_RATIO), DRAWER_HEIGHT_MAX_PX);
  assert.equal(band.bandHeight, expected);
  assert.equal(band.canvasHeight, 800 - expected);
});

test('computeBand: open + very tall viewport → band capped at max', () => {
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: 2000 }));
  assert.equal(band.bandHeight, DRAWER_HEIGHT_MAX_PX);
});

test('computeBand: open + viewport under floor → forced to rail', () => {
  const short = MIN_DRAWER_VIEWPORT_PX - 10;
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: short }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
});

test('computeBand: open + viewport under floor + railHidden → forced to peek', () => {
  const short = MIN_DRAWER_VIEWPORT_PX - 10;
  const band = computeBand(
    baseState({ drawerOpen: true, railHidden: true, viewportHeight: short }),
  );
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
});

test('computeBand: edit mode forces rail regardless of drawerOpen', () => {
  const band = computeBand(baseState({ drawerOpen: true, isEditMode: true }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
});

test('computeBand: edit mode + railHidden → peek (respects user hide)', () => {
  const band = computeBand(baseState({ drawerOpen: true, isEditMode: true, railHidden: true }));
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
});

test('computeBand: canvas height never negative', () => {
  const band = computeBand(baseState({ viewportHeight: 0, drawerOpen: false }));
  assert.equal(band.canvasHeight >= 0, true);
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `cd webview-ui && npm test`
Expected: FAIL — `drawerLayout.ts` doesn't exist yet.

- [ ] **Step 3: Implement drawerLayout.ts**

Create `webview-ui/src/office/drawer/drawerLayout.ts`:

```ts
import {
  DRAWER_HEIGHT_MAX_PX,
  DRAWER_HEIGHT_RATIO,
  MIN_DRAWER_VIEWPORT_PX,
  PEEK_HEIGHT_PX,
  RAIL_HEIGHT_PX,
} from '../../constants.js';
import { DrawerMode } from './drawerTypes.js';
import type { DrawerState } from './drawerTypes.js';

export interface Band {
  mode: DrawerMode;
  bandHeight: number;
  canvasHeight: number;
}

function drawerBandHeight(viewportHeight: number): number {
  return Math.min(Math.round(viewportHeight * DRAWER_HEIGHT_RATIO), DRAWER_HEIGHT_MAX_PX);
}

function collapsedBand(railHidden: boolean): { mode: DrawerMode; bandHeight: number } {
  return railHidden
    ? { mode: DrawerMode.PEEK, bandHeight: PEEK_HEIGHT_PX }
    : { mode: DrawerMode.RAIL, bandHeight: RAIL_HEIGHT_PX };
}

export function computeBand(state: DrawerState): Band {
  const { drawerOpen, railHidden, isEditMode, viewportHeight } = state;

  const forceCollapsed = isEditMode || viewportHeight < MIN_DRAWER_VIEWPORT_PX;
  const effectivelyOpen = drawerOpen && !forceCollapsed;

  const { mode, bandHeight } = effectivelyOpen
    ? { mode: DrawerMode.OPEN, bandHeight: drawerBandHeight(viewportHeight) }
    : collapsedBand(railHidden);

  const canvasHeight = Math.max(0, viewportHeight - bandHeight);
  return { mode, bandHeight, canvasHeight };
}
```

- [ ] **Step 4: Run the tests, watch them pass**

Run: `cd webview-ui && npm test`
Expected: all `drawer-layout` tests PASS. The existing `seat-classification` and `dev-assets` tests should still pass.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/drawer/drawerLayout.ts webview-ui/test/drawer-layout.test.ts
git commit -m "feat(webview): drawer band layout math + tests"
```

---

## Task 5: Drawer state transitions (TDD)

**Files:**

- Create: `webview-ui/src/office/drawer/drawerState.ts`
- Test: `webview-ui/test/drawer-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `webview-ui/test/drawer-state.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  closeAgent,
  focusOrToggle,
  setEditMode,
  setViewportHeight,
  toggleRailHidden,
} from '../src/office/drawer/drawerState.ts';
import type { DrawerState } from '../src/office/drawer/drawerTypes.ts';

function baseState(over: Partial<DrawerState> = {}): DrawerState {
  return {
    drawerOpen: false,
    railHidden: false,
    focusedAgentId: null,
    isEditMode: false,
    viewportHeight: 800,
    ...over,
  };
}

test('focusOrToggle: first focus opens drawer and sets focused id', () => {
  const next = focusOrToggle(baseState(), 5);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('focusOrToggle: clicking focused agent again collapses drawer', () => {
  const open = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 5);
  assert.equal(next.drawerOpen, false);
  assert.equal(next.focusedAgentId, 5); // keep id; used for re-open
});

test('focusOrToggle: clicking a different agent switches focus, keeps drawer open', () => {
  const open = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 7);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 7);
});

test('focusOrToggle: clicking focused agent when drawer already closed re-opens', () => {
  const closed = baseState({ drawerOpen: false, focusedAgentId: 5 });
  const next = focusOrToggle(closed, 5);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('closeAgent: removes focus if closed agent was focused', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, /* mostRecentOther */ 3);
  assert.equal(next.focusedAgentId, 3);
  assert.equal(next.drawerOpen, true);
});

test('closeAgent: when no other agent remains, collapses drawer', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, null);
  assert.equal(next.focusedAgentId, null);
  assert.equal(next.drawerOpen, false);
});

test('closeAgent: unrelated id close leaves state untouched', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 7, 3);
  assert.deepEqual(next, state);
});

test('toggleRailHidden: flips railHidden boolean', () => {
  const a = toggleRailHidden(baseState({ railHidden: false }));
  assert.equal(a.railHidden, true);
  const b = toggleRailHidden(a);
  assert.equal(b.railHidden, false);
});

test('setEditMode: setting to true does not mutate drawerOpen (override is visual)', () => {
  const state = baseState({ drawerOpen: true });
  const next = setEditMode(state, true);
  assert.equal(next.isEditMode, true);
  assert.equal(next.drawerOpen, true);
});

test('setEditMode: exiting edit mode leaves drawerOpen intact', () => {
  const state = baseState({ drawerOpen: true, isEditMode: true });
  const next = setEditMode(state, false);
  assert.equal(next.isEditMode, false);
  assert.equal(next.drawerOpen, true);
});

test('setViewportHeight: shrinking below floor does not mutate drawerOpen', () => {
  const state = baseState({ drawerOpen: true, viewportHeight: 800 });
  const next = setViewportHeight(state, 200);
  assert.equal(next.viewportHeight, 200);
  assert.equal(next.drawerOpen, true); // computeBand handles the override
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `cd webview-ui && npm test`
Expected: FAIL — `drawerState.ts` doesn't exist.

- [ ] **Step 3: Implement drawerState.ts**

Create `webview-ui/src/office/drawer/drawerState.ts`:

```ts
import type { DrawerState } from './drawerTypes.js';

export function focusOrToggle(state: DrawerState, agentId: number): DrawerState {
  if (state.drawerOpen && state.focusedAgentId === agentId) {
    return { ...state, drawerOpen: false };
  }
  return { ...state, drawerOpen: true, focusedAgentId: agentId };
}

export function closeAgent(
  state: DrawerState,
  closedId: number,
  mostRecentOtherAgentId: number | null,
): DrawerState {
  if (state.focusedAgentId !== closedId) return state;
  if (mostRecentOtherAgentId == null) {
    return { ...state, focusedAgentId: null, drawerOpen: false };
  }
  return { ...state, focusedAgentId: mostRecentOtherAgentId };
}

export function toggleRailHidden(state: DrawerState): DrawerState {
  return { ...state, railHidden: !state.railHidden };
}

export function setEditMode(state: DrawerState, isEditMode: boolean): DrawerState {
  return { ...state, isEditMode };
}

export function setViewportHeight(state: DrawerState, viewportHeight: number): DrawerState {
  return { ...state, viewportHeight };
}
```

- [ ] **Step 4: Run the tests, watch them pass**

Run: `cd webview-ui && npm test`
Expected: all drawer-state + drawer-layout + existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/drawer/drawerState.ts webview-ui/test/drawer-state.test.ts
git commit -m "feat(webview): drawer state transitions + tests"
```

---

## Task 6: Persistence wrapper

**Files:**

- Create: `webview-ui/src/office/drawer/drawerPersistence.ts`

- [ ] **Step 1: Create the persistence wrapper**

Write to `webview-ui/src/office/drawer/drawerPersistence.ts`:

```ts
import { vscode } from '../../vscodeApi.js';
import type { DrawerPersistedState } from './drawerTypes.js';

const STATE_KEY = 'pixelAgents.drawer';

interface Persisted {
  [STATE_KEY]?: DrawerPersistedState;
}

const DEFAULT: DrawerPersistedState = {
  drawerOpen: false,
  railHidden: false,
};

export function loadDrawerState(): DrawerPersistedState {
  const raw = vscode.getState<Persisted>();
  const slice = raw?.[STATE_KEY];
  if (!slice || typeof slice !== 'object') return DEFAULT;
  return {
    drawerOpen: !!slice.drawerOpen,
    railHidden: !!slice.railHidden,
  };
}

export function saveDrawerState(state: DrawerPersistedState): void {
  const prev = vscode.getState<Persisted>() ?? {};
  vscode.setState({ ...prev, [STATE_KEY]: state });
}
```

Design note: we merge into whatever webview state already exists under other keys; we don't own the whole `vscode.setState` payload.

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/drawer/drawerPersistence.ts
git commit -m "feat(webview): drawer persistence helpers (per-webview)"
```

---

## Task 7: useDrawerState hook

**Files:**

- Create: `webview-ui/src/office/drawer/useDrawerState.ts`

The hook combines state, persistence, and viewport-tracking. It exposes callbacks that wrap the pure state functions and writes persisted fields back on change.

- [ ] **Step 1: Create the hook**

Write to `webview-ui/src/office/drawer/useDrawerState.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { computeBand } from './drawerLayout.js';
import { loadDrawerState, saveDrawerState } from './drawerPersistence.js';
import {
  closeAgent as closeAgentReducer,
  focusOrToggle as focusOrToggleReducer,
  setEditMode as setEditModeReducer,
  setViewportHeight as setViewportHeightReducer,
  toggleRailHidden as toggleRailHiddenReducer,
} from './drawerState.js';
import type { DrawerState } from './drawerTypes.js';

export interface DrawerApi {
  state: DrawerState;
  band: ReturnType<typeof computeBand>;
  focusOrToggle(agentId: number): void;
  openForNewAgent(agentId: number): void;
  closeAgent(closedId: number, mostRecentOtherAgentId: number | null): void;
  toggleRailHidden(): void;
  collapse(): void;
}

/**
 * Orchestrates drawer state for one webview.
 *
 * @param containerRef element whose height drives viewport-shrink safety.
 * @param isEditMode   external signal from the editor; forces visual collapse.
 */
export function useDrawerState(
  containerRef: RefObject<HTMLElement | null>,
  isEditMode: boolean,
): DrawerApi {
  const initial = useMemo<DrawerState>(() => {
    const persisted = loadDrawerState();
    return {
      ...persisted,
      focusedAgentId: null,
      isEditMode,
      viewportHeight:
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800,
    };
  }, [isEditMode]);

  const [state, setState] = useState<DrawerState>(initial);

  // Persist `drawerOpen` + `railHidden` whenever they change.
  const lastPersistedRef = useRef<{ drawerOpen: boolean; railHidden: boolean }>({
    drawerOpen: initial.drawerOpen,
    railHidden: initial.railHidden,
  });
  useEffect(() => {
    const { drawerOpen, railHidden } = state;
    const last = lastPersistedRef.current;
    if (last.drawerOpen !== drawerOpen || last.railHidden !== railHidden) {
      saveDrawerState({ drawerOpen, railHidden });
      lastPersistedRef.current = { drawerOpen, railHidden };
    }
  }, [state]);

  // Mirror external edit-mode signal into state (affects band computation).
  useEffect(() => {
    setState((s) => (s.isEditMode === isEditMode ? s : setEditModeReducer(s, isEditMode)));
  }, [isEditMode]);

  // Track container height for viewport-shrink safety.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (h: number) =>
      setState((s) => (s.viewportHeight === h ? s : setViewportHeightReducer(s, h)));
    update(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const focusOrToggle = useCallback((agentId: number) => {
    setState((s) => focusOrToggleReducer(s, agentId));
  }, []);

  const openForNewAgent = useCallback((agentId: number) => {
    // Always open on + Agent (viewport-shrink safety is enforced by computeBand).
    setState((s) => ({ ...s, drawerOpen: true, focusedAgentId: agentId }));
  }, []);

  const closeAgent = useCallback((closedId: number, mostRecentOtherAgentId: number | null) => {
    setState((s) => closeAgentReducer(s, closedId, mostRecentOtherAgentId));
  }, []);

  const toggleRailHidden = useCallback(() => {
    setState((s) => toggleRailHiddenReducer(s));
  }, []);

  const collapse = useCallback(() => {
    setState((s) => (s.drawerOpen ? { ...s, drawerOpen: false } : s));
  }, []);

  const band = useMemo(() => computeBand(state), [state]);

  return { state, band, focusOrToggle, openForNewAgent, closeAgent, toggleRailHidden, collapse };
}
```

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/drawer/useDrawerState.ts
git commit -m "feat(webview): useDrawerState hook (state + persistence + resize)"
```

---

## Task 8: AgentCell shared component

**Files:**

- Create: `webview-ui/src/office/drawer/AgentCell.tsx`

The rail and the tab strip both render agent cells. This component has two size variants.

- [ ] **Step 1: Create AgentCell**

Write to `webview-ui/src/office/drawer/AgentCell.tsx`:

```tsx
import type { AgentSummary } from './drawerTypes.js';

interface AgentCellProps {
  agent: AgentSummary;
  variant: 'rail' | 'tab';
  isFocused: boolean;
  onClick: () => void;
}

const SIZES = {
  rail: { width: 72, height: 20, fontSize: 10 },
  tab: { width: 56, height: 16, fontSize: 9 },
} as const;

const STATUS_COLOR: Record<AgentSummary['status'], string> = {
  active: '#4ade80',
  waiting: '#f59e0b',
  idle: '#6b7280',
};

export function AgentCell({ agent, variant, isFocused, onClick }: AgentCellProps) {
  const { width, height, fontSize } = SIZES[variant];
  const borderColor = isFocused ? '#4ade80' : '#4a4a6e';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width,
        height,
        background: '#1e1e2e',
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px',
        cursor: 'pointer',
        fontSize,
        fontFamily: 'inherit',
      }}
      title={agent.name}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 8,
          background: '#f5c2a7',
          flex: '0 0 auto',
        }}
      />
      <span
        style={{
          color: isFocused ? '#4ade80' : '#6b7280',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: '1 1 auto',
          textAlign: 'left',
        }}
      >
        {agent.name}
      </span>
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 0,
          background: STATUS_COLOR[agent.status],
          flex: '0 0 auto',
        }}
      />
    </button>
  );
}
```

Design note: the sprite stub is a colored rectangle for now. A follow-up can wire actual character sprites from `spriteCache` once we decide on a static-image extraction path.

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/drawer/AgentCell.tsx
git commit -m "feat(webview): AgentCell shared component (rail + tab variants)"
```

---

## Task 9: LiteRail and RailPeek

**Files:**

- Create: `webview-ui/src/office/drawer/LiteRail.tsx`
- Create: `webview-ui/src/office/drawer/RailPeek.tsx`

- [ ] **Step 1: Create LiteRail**

Write to `webview-ui/src/office/drawer/LiteRail.tsx`:

```tsx
import { RAIL_HEIGHT_PX } from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary } from './drawerTypes.js';

interface LiteRailProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  onFocusAgent: (id: number) => void;
  onHideRail: () => void;
}

export function LiteRail({ agents, focusedAgentId, onFocusAgent, onHideRail }: LiteRailProps) {
  return (
    <div
      style={{
        height: RAIL_HEIGHT_PX,
        background: '#0a0a14',
        borderTop: '2px solid #4a4a6e',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {agents.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant="rail"
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
          color: '#6b7280',
          fontSize: 10,
          fontFamily: 'inherit',
          cursor: 'pointer',
          padding: '0 4px',
        }}
        title="Hide rail"
      >
        [hide]
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create RailPeek**

Write to `webview-ui/src/office/drawer/RailPeek.tsx`:

```tsx
import { PEEK_HEIGHT_PX } from '../../constants.js';

interface RailPeekProps {
  onRestore: () => void;
}

export function RailPeek({ onRestore }: RailPeekProps) {
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-label="Show rail"
      title="Show rail"
      style={{
        height: PEEK_HEIGHT_PX,
        width: '100%',
        background: '#0a0a14',
        border: 'none',
        borderTop: '2px solid #4a4a6e',
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
```

- [ ] **Step 3: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/office/drawer/LiteRail.tsx webview-ui/src/office/drawer/RailPeek.tsx
git commit -m "feat(webview): LiteRail and RailPeek components"
```

---

## Task 10: DrawerHeader and TerminalPaneStub

**Files:**

- Create: `webview-ui/src/office/drawer/DrawerHeader.tsx`
- Create: `webview-ui/src/office/drawer/TerminalPaneStub.tsx`

- [ ] **Step 1: Create DrawerHeader**

Write to `webview-ui/src/office/drawer/DrawerHeader.tsx`:

```tsx
import { AgentCell } from './AgentCell.js';
import type { AgentSummary } from './drawerTypes.js';

interface DrawerHeaderProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
}

const HEADER_HEIGHT_PX = 22;

export function DrawerHeader({
  agents,
  focusedAgentId,
  onFocusAgent,
  onCollapse,
}: DrawerHeaderProps) {
  const focused = agents.find((a) => a.id === focusedAgentId) ?? null;
  const others = agents.filter((a) => a.id !== focusedAgentId);

  return (
    <div
      style={{
        height: HEADER_HEIGHT_PX,
        background: '#0a0a14',
        borderTop: '2px solid #4a4a6e',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
      }}
    >
      {focused && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 6px',
            border: '1px solid #4ade80',
            height: 16,
            background: '#1e1e2e',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 10,
              background: '#f5c2a7',
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: '#4ade80', fontSize: 10, fontFamily: 'inherit' }}>
            {focused.name}
          </span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
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
            variant="tab"
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
          color: '#6b7280',
          fontSize: 10,
          fontFamily: 'inherit',
          cursor: 'pointer',
          padding: '0 4px',
        }}
        title="Hide drawer"
      >
        [↓ hide]
      </button>
    </div>
  );
}

export { HEADER_HEIGHT_PX };
```

- [ ] **Step 2: Create TerminalPaneStub**

Write to `webview-ui/src/office/drawer/TerminalPaneStub.tsx`:

```tsx
interface TerminalPaneStubProps {
  agentId: number | null;
  agentName: string | null;
}

export function TerminalPaneStub({ agentId, agentName }: TerminalPaneStubProps) {
  if (agentId == null) {
    return (
      <div
        style={{
          flex: '1 1 auto',
          background: '#0a0a14',
          color: '#6b7280',
          fontSize: 11,
          fontFamily: 'inherit',
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
        background: '#0a0a14',
        color: '#4ade80',
        fontSize: 11,
        fontFamily: 'inherit',
        padding: 12,
        overflow: 'auto',
      }}
    >
      <div>
        [ terminal stub — agent #{agentId} ({agentName ?? 'unknown'}) ]
      </div>
      <div style={{ color: '#6b7280', marginTop: 4 }}>
        xterm.js will replace this stub once the pty backend (D2) lands. For now, the terminal still
        runs in VS Code&apos;s native terminal strip.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/office/drawer/DrawerHeader.tsx webview-ui/src/office/drawer/TerminalPaneStub.tsx
git commit -m "feat(webview): DrawerHeader + TerminalPaneStub"
```

---

## Task 11: BottomDrawer shell

**Files:**

- Create: `webview-ui/src/office/drawer/BottomDrawer.tsx`

- [ ] **Step 1: Create BottomDrawer**

Write to `webview-ui/src/office/drawer/BottomDrawer.tsx`:

```tsx
import { DrawerHeader, HEADER_HEIGHT_PX } from './DrawerHeader.js';
import { DrawerMode } from './drawerTypes.js';
import type { AgentSummary, DrawerState } from './drawerTypes.js';
import { LiteRail } from './LiteRail.js';
import { RailPeek } from './RailPeek.js';
import { TerminalPaneStub } from './TerminalPaneStub.js';
import type { Band } from './drawerLayout.js';

interface BottomDrawerProps {
  agents: AgentSummary[];
  state: DrawerState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
}

export function BottomDrawer({
  agents,
  state,
  band,
  onFocusAgent,
  onCollapse,
  onToggleRailHidden,
}: BottomDrawerProps) {
  const focused = agents.find((a) => a.id === state.focusedAgentId) ?? null;

  if (band.mode === DrawerMode.PEEK) {
    return (
      <div style={{ height: band.bandHeight, flex: `0 0 ${band.bandHeight}px` }}>
        <RailPeek onRestore={onToggleRailHidden} />
      </div>
    );
  }

  if (band.mode === DrawerMode.RAIL) {
    return (
      <div style={{ height: band.bandHeight, flex: `0 0 ${band.bandHeight}px` }}>
        <LiteRail
          agents={agents}
          focusedAgentId={state.focusedAgentId}
          onFocusAgent={onFocusAgent}
          onHideRail={onToggleRailHidden}
        />
      </div>
    );
  }

  // OPEN
  const terminalHeight = Math.max(0, band.bandHeight - HEADER_HEIGHT_PX);
  return (
    <div
      style={{
        height: band.bandHeight,
        flex: `0 0 ${band.bandHeight}px`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DrawerHeader
        agents={agents}
        focusedAgentId={state.focusedAgentId}
        onFocusAgent={onFocusAgent}
        onCollapse={onCollapse}
      />
      <div style={{ height: terminalHeight, display: 'flex', flexDirection: 'column' }}>
        <TerminalPaneStub agentId={state.focusedAgentId} agentName={focused?.name ?? null} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/drawer/BottomDrawer.tsx
git commit -m "feat(webview): BottomDrawer shell component"
```

---

## Task 12: Integrate BottomDrawer into App.tsx

This is the biggest task. It touches existing layout and wires focus actions.

**Files:**

- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Add imports at the top of App.tsx**

Add these imports alongside the existing imports (preserving the existing alphabetical-ish order):

```ts
import { BottomDrawer } from './office/drawer/BottomDrawer.js';
import type { AgentSummary } from './office/drawer/drawerTypes.js';
import { useDrawerState } from './office/drawer/useDrawerState.js';
```

- [ ] **Step 2: Add the drawer hook call and build agent summaries**

Inside `App()`, after `const officeState = getOfficeState();` (currently line 160), add:

```ts
const drawer = useDrawerState(containerRef, editor.isEditMode);

const agentSummaries = useMemo<AgentSummary[]>(() => {
  const os = getOfficeState();
  const chars = os.getCharacters();
  return agents
    .map((id) => chars.find((ch) => ch.id === id))
    .filter((ch): ch is NonNullable<typeof ch> => ch != null)
    .map((ch): AgentSummary => {
      const statusStr = agentStatuses[ch.id];
      const toolList = agentTools[ch.id];
      const uiStatus: AgentSummary['status'] =
        statusStr === 'waiting' ? 'waiting' : toolList && toolList.length > 0 ? 'active' : 'idle';
      return {
        id: ch.id,
        name: ch.terminalName ?? ch.folderName ?? `Agent ${ch.id}`,
        palette: ch.palette,
        hueShift: ch.hueShift,
        status: uiStatus,
      };
    });
}, [agents, agentStatuses, agentTools]);
```

Notes for the engineer:

- `agents` from `useExtensionMessages` is `number[]`. Character details (palette, hueShift, terminalName, folderName) live on the `Character` objects stored in `OfficeState`; fetch via `officeState.getCharacters()`.
- Intentionally depending on React-tracked state (`agents`, `agentStatuses`, `agentTools`) for the memo key — `officeState` is imperative and won't trigger re-renders on its own. Re-building when `agents` changes is sufficient for the drawer UI since the character list changes in lockstep with `agents`.

Also add `useMemo` to the `react` import at the top if not already imported:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

(`useMemo` is likely not imported today — check before editing to avoid duplicate imports.)

- [ ] **Step 3: Replace handleClick to route through the drawer focus action**

The existing `handleClick` sends a `focusAgent` postMessage. Keep that (extension needs to focus VS Code terminal) AND add drawer focus:

Replace the `handleClick` declaration with:

```ts
const handleClick = useCallback(
  (agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    vscode.postMessage({ type: 'focusAgent', id: focusId });
    drawer.focusOrToggle(focusId);
  },
  [drawer],
);
```

- [ ] **Step 4: Auto-open the drawer on new agent spawn**

Find the `useExtensionMessages` return destructure. We need to know when a _new_ agent has just been created. The current code doesn't expose that directly — check whether `useExtensionMessages` exposes a `lastCreatedAgentId` or similar.

If not, add a local ref that tracks the largest seen agent id and opens the drawer when it grows:

Right after `const agentSummaries = useMemo(...)`, add:

```ts
const seenMaxIdRef = useRef<number>(-Infinity);
useEffect(() => {
  const maxId = agents.reduce((m, a) => Math.max(m, a.id), -Infinity);
  if (maxId > seenMaxIdRef.current) {
    if (seenMaxIdRef.current > -Infinity) {
      // Not the initial population — this is a newly-created agent.
      drawer.openForNewAgent(maxId);
    }
    seenMaxIdRef.current = maxId;
  }
}, [agents, drawer]);
```

Rationale for the `> -Infinity` check: on the very first render, `agents` populating with previously-restored agents should NOT auto-open the drawer — that would violate decision #2 (collapsed on first run). Only subsequent max-id growth (a true `+ Agent` click) triggers the auto-open.

- [ ] **Step 5: Handle agent close → update drawer focus**

Find the existing `handleCloseAgent` and replace it with:

```ts
const handleCloseAgent = useCallback(
  (id: number) => {
    // Pick the next agent to focus (most recent other agent, if any)
    const others = agents.filter((a) => a.id !== id).map((a) => a.id);
    const mostRecentOther = others.length > 0 ? Math.max(...others) : null;
    drawer.closeAgent(id, mostRecentOther);
    vscode.postMessage({ type: 'closeAgent', id });
  },
  [agents, drawer],
);
```

- [ ] **Step 6: Restructure the root JSX as a flex column**

Replace the root `<div ref={containerRef} …>` opening line and everything up to `<OfficeCanvas …/>` with a flex-column layout. Find:

```tsx
return (
  <div ref={containerRef} className="w-full h-full relative overflow-hidden">
    <OfficeCanvas
```

Change to:

```tsx
return (
  <div
    ref={containerRef}
    className="w-full h-full relative overflow-hidden"
    style={{ display: 'flex', flexDirection: 'column' }}
  >
    <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
      <OfficeCanvas
```

And then find the closing of the existing render block. The existing return currently wraps `OfficeCanvas`, `ToolOverlay`, `BottomToolbar`, all in one relative container. We need:

1. The top (flex:1) region contains: `OfficeCanvas`, `ZoomControls`, `vignette`, `EditActionBar`, `showRotateHint`, `EditorToolbar`, `ToolOverlay`, `DebugView`, `Tooltip`, hooks modal, `BottomToolbar`, `VersionIndicator`, `ChangelogModal`, `SettingsModal`, `MigrationNotice`.
2. The bottom (flex:0 0 bandHeight) region contains: `BottomDrawer`.

The simplest restructuring that preserves existing absolute-positioned children (which reference `containerRef.current` for coordinate math in `ToolOverlay`) is:

- Keep `containerRef` on the outer flex-column div.
- Wrap the existing absolutely-positioned content (everything currently inside the outer div) in a new `<div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>` — this preserves the positioning context for existing absolute children while taking remaining flex space.
- Mount `BottomDrawer` as a sibling after that inner div.

Concretely, the existing JSX:

```tsx
return (
  <div ref={containerRef} className="w-full h-full relative overflow-hidden">
    <OfficeCanvas …/>
    {!isDebugMode ? (…) : (…)}
    {/* tooltips, modals */}
    <BottomToolbar …/>
    <VersionIndicator …/>
    <ChangelogModal …/>
    <SettingsModal …/>
    {showMigrationNotice && <MigrationNotice …/>}
  </div>
);
```

becomes:

```tsx
return (
  <div
    ref={containerRef}
    className="w-full h-full overflow-hidden"
    style={{ display: 'flex', flexDirection: 'column' }}
  >
    <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
      <OfficeCanvas …/>
      {!isDebugMode ? (…) : (…)}
      {/* tooltips, modals */}
      <BottomToolbar …/>
      <VersionIndicator …/>
      <ChangelogModal …/>
      <SettingsModal …/>
      {showMigrationNotice && <MigrationNotice …/>}
    </div>
    <BottomDrawer
      agents={agentSummaries}
      state={drawer.state}
      band={drawer.band}
      onFocusAgent={handleClick}
      onCollapse={drawer.collapse}
      onToggleRailHidden={drawer.toggleRailHidden}
    />
  </div>
);
```

Dropping `relative` from the outer div's className is fine because the new inner wrapper provides the positioning context. The `OfficeCanvas` gets its size from the inner wrapper (flex:1) — existing DPR/zoom math inside OfficeCanvas already reacts to container size changes.

- [ ] **Step 7: Build**

Run: `cd webview-ui && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add webview-ui/src/App.tsx
git commit -m "feat(webview): mount BottomDrawer in App; wire focus + + Agent + close"
```

---

## Task 13: Manual verification in extension dev host

**Files:** none (verification only)

- [ ] **Step 1: Run the full build**

Run from repo root:

```bash
npm run build
```

Expected: extension bundle + webview bundle both produced without errors.

- [ ] **Step 2: Launch the extension dev host (F5 from VS Code) and verify**

Check each:

- [ ] Extension loads without console errors
- [ ] Side panel opens with the office visible and a **rail** visible at the bottom
- [ ] Click `+ Agent` → new character spawns AND drawer opens to the new agent (assuming viewport ≥ 360px)
- [ ] Click a character in the office → drawer shows that agent in the focused-frame; previously-focused agent now appears in the tab strip
- [ ] Click the focused character again → drawer collapses to rail
- [ ] Click a rail cell → drawer opens to that agent
- [ ] Click `[hide]` on the rail → rail collapses to peek tab; click peek → rail restored
- [ ] Enter Layout edit mode → drawer force-collapses to rail (or peek, if rail was hidden); open/hide buttons are disabled (clicking them does nothing while in edit mode)
- [ ] Exit edit mode → previous drawer state restored
- [ ] Close the extension dev host, reopen → drawer state (open/closed, rail visibility) is restored per-webview
- [ ] Open side panel AND full-screen panel → drawer states are independent; opening drawer in one does not open it in the other
- [ ] Shrink the side panel below ~360px height → drawer force-collapses even if `drawerOpen` is true; grow back → drawer does not auto-reopen

- [ ] **Step 3: Document any bugs found and fix them**

If any verification step fails, add a small commit per bug with a descriptive message. Re-run verification after each fix.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git log --oneline -20
```

Confirm the commit history is clean and tells a coherent story. If you made verification fixes, they should be separate commits on top of Task 12.

---

## Out of Scope (Future Plans)

- **xterm.js integration.** Requires D1 (`MessageSource` refactor) and D2 (`node-pty` backend) to land first. Follow-up plan replaces `TerminalPaneStub` with a real `TerminalPane` that subscribes to pty messages.
- **Actual character sprites in AgentCell.** For now the sprite is a colored rectangle placeholder. A follow-up can render the real character sprite from `spriteCache` using a static image extraction.
- **Copy/paste integration with xterm.js.** Parent spec carries as open.
- **ptyBacked feature flag + legacy path removal.** Belongs to the D2 follow-up.

---

## Self-Review Checklist (run before handoff)

- [ ] Every step with code shows the actual code — no "similar to above" or "TODO"
- [ ] File paths are absolute from repo root (e.g. `webview-ui/src/...`)
- [ ] No type drift — `AgentSummary`, `DrawerState`, `Band` are consistent everywhere
- [ ] Each state transition has a corresponding test
- [ ] Spec sections are all addressed:
  - [ ] Layout math (Task 4)
  - [ ] State transitions (Task 5)
  - [ ] Per-webview persistence (Task 6, 7)
  - [ ] ResizeObserver → viewport-shrink safety (Task 7)
  - [ ] Focus-or-toggle on click (Task 12 step 3)
  - [ ] - Agent auto-open (Task 12 step 4)
  - [ ] Agent close → drawer re-focus (Task 12 step 5)
  - [ ] Edit-mode force-collapse (Task 4 + Task 7 wiring through `isEditMode`)
  - [ ] Per-webview independence (uses `vscode.setState`, not extension globalState)
  - [ ] Rail hide + peek restore (Task 9 + 11)
- [ ] Tests can be run with the existing `npm test` harness (no new deps)
