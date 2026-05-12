# Terminal Experience Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three terminal-experience improvements bundled together: (1) auto-rename agents from Claude session names via JSONL `custom-title` records, (2) draggable splitter for the panel band + 0.5 zoom increments, (3) bundled monospace font choices + size + line-height for the in-panel xterm.

**Architecture:** Each item is independent. Rename adds a new branch in `src/transcriptParser.ts` that broadcasts `agentRenamed` to the webview. Splitter adds `userBandSizePx` to `PanelPersistedState` and a new `<Splitter/>` component; `computePanelBand` honors the override with a clamp. Zoom adds half-step values to `ZOOM_STEPS`. Fonts are bundled as `.woff2`, declared in CSS `@font-face`, exposed through the existing Settings modal until the redesign ships.

**Tech Stack:** TypeScript, React, Vitest (extension-side), Node test runner (webview-side), xterm.js, esbuild.

**Spec:** `docs/superpowers/specs/2026-05-12-terminal-experience-polish-design.md`

---

## Preconditions

- Working on a clean branch off `main`. The plan creates one branch and commits along the way.
- All existing tests pass: `npm test` is green before starting.
- Node + npm installed; dependencies installed (`npm install` at repo root, `cd webview-ui && npm install`, `cd server && npm install`).

## File Structure

**Created:**

- `src/__tests__/transcriptParser.test.ts` — Vitest tests for `custom-title` handler.
- `webview-ui/src/office/panel/Splitter.tsx` — drag handle component.
- `webview-ui/public/fonts/terminal/fira-code.woff2` — bundled font.
- `webview-ui/public/fonts/terminal/jetbrains-mono.woff2` — bundled font.
- `webview-ui/public/fonts/terminal/cascadia-mono.woff2` — bundled font.
- `webview-ui/public/fonts/terminal/ibm-plex-mono.woff2` — bundled font.

**Modified:**

- `src/types.ts` — add `customTitle?: string` to `AgentState`, `PersistedAgent`.
- `src/constants.ts` — add `GLOBAL_KEY_TERMINAL_FONT_FAMILY`, `GLOBAL_KEY_TERMINAL_LINE_HEIGHT`.
- `src/transcriptParser.ts` — add `custom-title` case before unknown-type fallback.
- `src/PixelAgentsViewProvider.ts` — handle `setTerminalFontFamily` / `setTerminalLineHeight` messages; include both in `settingsLoaded`.
- `webview-ui/src/constants.ts` — replace integer `ZOOM_MIN`/`ZOOM_MAX` usage with `ZOOM_STEPS` array; add `PANEL_USER_MIN_PX`, `PANEL_BOTTOM_USER_MAX_RESERVE`, `PANEL_SIDE_USER_MAX_RESERVE`.
- `webview-ui/src/office/panel/panelTypes.ts` — add `userBandSizePx?: number` to `PanelPersistedState`.
- `webview-ui/src/office/panel/panelLayout.ts` — honor `userBandSizePx` with clamp in `computePanelBand`.
- `webview-ui/src/office/panel/panelPersistence.ts` — round-trip `userBandSizePx`.
- `webview-ui/src/office/panel/OfficePanel.tsx` — mount `<Splitter/>` on the panel's outer edge when `mode === OPEN`.
- `webview-ui/src/office/panel/TerminalPane.tsx` — pass `fontFamily`/`lineHeight` to xterm.
- `webview-ui/src/office/engine/characters.ts` — `Character.customTitle?: string`.
- `webview-ui/src/office/components/ToolOverlay.tsx` — prefer `customTitle` in label.
- `webview-ui/src/office/panel/PanelHeader.tsx` — prefer `customTitle` in tab label.
- `webview-ui/src/components/ZoomControls.tsx` — step through `ZOOM_STEPS` array.
- `webview-ui/src/components/SettingsModal.tsx` — Terminal section (font family dropdown, line-height stepper); font size already present.
- `webview-ui/src/hooks/useExtensionMessages.ts` — handle `agentRenamed`; track `terminalFontFamily`, `terminalLineHeight`.
- `webview-ui/src/index.css` — `@font-face` declarations for the four bundled fonts.
- `webview-ui/test/panel-layout.test.ts` — add `userBandSizePx` cases.
- `esbuild.js` — verify font copy from `webview-ui/public/fonts/terminal/` to `dist/assets/fonts/terminal/` (Vite already copies `public/` so this may be a no-op; verify in Task 16).

**Test files:**

- `src/__tests__/transcriptParser.test.ts` — new.
- `webview-ui/test/panel-layout.test.ts` — extended.

---

# Part A — Auto-rename from Claude session name

## Task A1: Branch

**Files:**

- None.

- [ ] **Step 1: Create branch**

```bash
git checkout -b 2026-05-12-terminal-polish
```

- [ ] **Step 2: Verify clean baseline**

Run: `npm test`
Expected: PASS (all suites). If any test fails, stop and fix before continuing.

## Task A2: Add `customTitle` to `AgentState` and `PersistedAgent`

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Add field to `AgentState`**

In `src/types.ts`, locate the `AgentState` interface (search for `agentName?: string;` inside it). Add immediately after the `// -- Agent Teams --` block:

```ts
  /** Display name set by Claude's /rename command (read from JSONL custom-title record).
   *  Takes precedence over agentName and terminalName in the UI. */
  customTitle?: string;
```

- [ ] **Step 2: Add field to `PersistedAgent`**

Same file, locate the `PersistedAgent` interface. Add after its `agentName?: string;` line:

```ts
  customTitle?: string;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "types: add customTitle field for Claude /rename support"
```

## Task A3: Write failing test for `custom-title` handler

**Files:**

- Create: `src/__tests__/transcriptParser.test.ts`

- [ ] **Step 1: Write the test**

Create `src/__tests__/transcriptParser.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { processTranscriptLine } from '../transcriptParser.js';
import type { AgentState, MessageSink } from '../types.js';

function makeAgent(id: number): AgentState {
  return {
    id,
    sessionId: 'session-xyz',
    isExternal: false,
    projectDir: '/tmp/proj',
    jsonlFile: '/tmp/proj/session-xyz.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    linesProcessed: 0,
    lastDataAt: 0,
    seenUnknownRecordTypes: new Set(),
  } as unknown as AgentState; // cast acceptable for unit test; runtime fields not all required
}

describe('custom-title record', () => {
  it('sets agent.customTitle and posts agentRenamed', () => {
    const agent = makeAgent(7);
    const agents = new Map([[7, agent]]);
    const sink: MessageSink = { postMessage: vi.fn() };
    const line = JSON.stringify({
      type: 'custom-title',
      customTitle: 'Frontend cleanup',
      sessionId: 'session-xyz',
    });

    processTranscriptLine(7, line, agents, new Map(), new Map(), sink);

    expect(agent.customTitle).toBe('Frontend cleanup');
    expect(sink.postMessage).toHaveBeenCalledWith({
      type: 'agentRenamed',
      id: 7,
      customTitle: 'Frontend cleanup',
    });
  });

  it('ignores custom-title with non-string title', () => {
    const agent = makeAgent(7);
    const agents = new Map([[7, agent]]);
    const sink: MessageSink = { postMessage: vi.fn() };
    const line = JSON.stringify({ type: 'custom-title', customTitle: 42, sessionId: 'x' });

    processTranscriptLine(7, line, agents, new Map(), new Map(), sink);

    expect(agent.customTitle).toBeUndefined();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm run test:extension -- transcriptParser`
Expected: FAIL — the `custom-title` case isn't implemented yet, so `agent.customTitle` is undefined and the sink isn't called.

- [ ] **Step 3: Commit (failing test)**

```bash
git add src/__tests__/transcriptParser.test.ts
git commit -m "test: failing transcript parser test for custom-title record"
```

## Task A4: Implement the `custom-title` case

**Files:**

- Modify: `src/transcriptParser.ts`

- [ ] **Step 1: Add the handler**

In `src/transcriptParser.ts`, locate the chain of `else if (record.type === 'system' && record.subtype === 'turn_duration')` (around line 363). Add a new `else if` immediately before the unknown-type fallback at line 422 (i.e., before `} else if (record.type && !agent.seenUnknownRecordTypes.has(record.type)) {`):

```ts
    } else if (record.type === 'custom-title' && typeof record.customTitle === 'string') {
      agent.customTitle = record.customTitle;
      webview?.postMessage({
        type: 'agentRenamed',
        id: agentId,
        customTitle: record.customTitle,
      });
    }
```

- [ ] **Step 2: Run test, verify it passes**

Run: `npm run test:extension -- transcriptParser`
Expected: PASS (both cases).

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: PASS — no regressions in other tests.

- [ ] **Step 4: Commit**

```bash
git add src/transcriptParser.ts
git commit -m "transcriptParser: handle custom-title records, broadcast agentRenamed"
```

## Task A5: Persist `customTitle` across reload

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts` (or wherever `persistAgents()` and `restoreAgents()` live — confirm at start of task)

- [ ] **Step 1: Find the serialize and restore sites**

Run: `grep -n "persistAgents\|customTitle\|terminalName" src/PixelAgentsViewProvider.ts src/agentManager.ts src/fileWatcher.ts | head -20`

Expected: lines that show where `PersistedAgent` objects are built (in `persistAgents` body) and read back (in `restoreAgents`).

- [ ] **Step 2: Include `customTitle` in serialization**

In the `persistAgents` body, the record built from each agent currently includes `agentName`, `terminalName`, etc. Add the new field. Locate the object literal and add the line right after `agentName: agent.agentName,`:

```ts
    customTitle: agent.customTitle,
```

- [ ] **Step 3: Restore the field on load**

In `restoreAgents` (or wherever the persisted record is unpacked into a new `AgentState`), add after the line that restores `agentName`:

```ts
    customTitle: persisted.customTitle,
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/PixelAgentsViewProvider.ts src/agentManager.ts src/fileWatcher.ts
git commit -m "persist agent customTitle across reload"
```

## Task A6: Receive `agentRenamed` in webview + render in character label

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`
- Modify: `webview-ui/src/office/engine/characters.ts`
- Modify: `webview-ui/src/office/components/ToolOverlay.tsx`
- Modify: `webview-ui/src/office/panel/PanelHeader.tsx`

- [ ] **Step 1: Add `customTitle` field to Character**

In `webview-ui/src/office/engine/characters.ts`, locate the `Character` interface/class. Add a field:

```ts
  customTitle?: string;
```

- [ ] **Step 2: Handle `agentRenamed` in webview hook**

In `webview-ui/src/hooks/useExtensionMessages.ts`, locate the message dispatch (search for `agentCreated`, `agentClosed`). Add a new case:

```ts
      } else if (msg.type === 'agentRenamed') {
        const id = msg.id as number;
        const customTitle = msg.customTitle as string;
        const ch = os.characters.get(id);
        if (ch) {
          ch.customTitle = customTitle;
        }
```

(Place it adjacent to other agent-state message handlers; the exact location is determined by the existing chain — match the surrounding `} else if` style.)

- [ ] **Step 3: Add label helper**

In `webview-ui/src/office/engine/characters.ts`, add an exported helper at the bottom of the file:

```ts
/** Resolve the display label for a character, in priority order. */
export function characterLabel(ch: {
  customTitle?: string;
  agentName?: string;
  terminalName?: string;
  id: number;
}): string {
  return ch.customTitle ?? ch.agentName ?? ch.terminalName ?? `Agent #${ch.id}`;
}
```

- [ ] **Step 4: Use the helper in ToolOverlay**

In `webview-ui/src/office/components/ToolOverlay.tsx`, find where the character label text is set (likely `agentName` or `terminalName` is referenced). Replace the resolution with a call to `characterLabel(character)`. Add import:

```ts
import { characterLabel } from '../engine/characters.js';
```

- [ ] **Step 5: Use the helper in PanelHeader**

Same change in `webview-ui/src/office/panel/PanelHeader.tsx` — replace the existing name resolution with `characterLabel(...)` and import the helper.

- [ ] **Step 6: Build + type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/office/engine/characters.ts webview-ui/src/office/components/ToolOverlay.tsx webview-ui/src/office/panel/PanelHeader.tsx
git commit -m "webview: render customTitle in character label, overlay, panel header"
```

## Task A7: Manual verification — rename + resume

**Files:** None.

- [ ] **Step 1: Build extension**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Launch Extension Dev Host**

Open VS Code on the repo. Press F5 to launch.

- [ ] **Step 3: Spawn agent and run `/rename`**

In the Extension Dev Host, open Pixel Agents → `+ Agent`. In the new terminal, type `/rename Test1` and press Enter.

Expected: within ~1s, the character's label (overlay + panel header) updates to `Test1`.

- [ ] **Step 4: Resume case**

Close the agent. Spawn a new one. In the new terminal type `/resume Test1` and press Enter.

Expected: the new agent's label updates to `Test1` shortly after resume.

- [ ] **Step 5: Reload preserves label**

Reload the Extension Dev Host (Cmd+R or "Developer: Reload Window") with `Test1` still active.

Expected: after restore, the agent's label is still `Test1`.

- [ ] **Step 6: Commit a marker**

If everything passed, commit a no-op marker so the PR history shows Part A is complete:

```bash
git commit --allow-empty -m "Part A complete: agent auto-rename"
```

---

# Part B — Splitter drag + 0.5 zoom

## Task B1: Add panel resize constants

**Files:**

- Modify: `webview-ui/src/constants.ts`

- [ ] **Step 1: Add constants**

In `webview-ui/src/constants.ts`, add a new block near the other `PANEL_*` constants:

```ts
/** User-resize bounds for the open panel band. Applied as a clamp on userBandSizePx. */
export const PANEL_USER_MIN_PX = 240;
/** Reserved canvas height when the panel is on the bottom (minimum room above the panel). */
export const PANEL_BOTTOM_USER_MAX_RESERVE = 200;
/** Reserved canvas width when the panel is on a side (minimum room next to the panel). */
export const PANEL_SIDE_USER_MAX_RESERVE = 360;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/constants.ts
git commit -m "constants: add panel user-resize min/reserve values"
```

## Task B2: Add `userBandSizePx` to `PanelPersistedState`

**Files:**

- Modify: `webview-ui/src/office/panel/panelTypes.ts`
- Modify: `webview-ui/src/office/panel/panelPersistence.ts`

- [ ] **Step 1: Add the field**

In `panelTypes.ts`, modify `PanelPersistedState`:

```ts
export interface PanelPersistedState {
  panelOpen: boolean;
  railHidden: boolean;
  panelPosition: PanelPosition;
  terminalFontSize: number;
  /** When set, overrides the viewport-ratio default band size for OPEN mode. */
  userBandSizePx?: number;
}
```

- [ ] **Step 2: Round-trip in persistence**

In `panelPersistence.ts`, find the `DEFAULT` const and the parse/serialize functions. Add `userBandSizePx: undefined` to `DEFAULT`. In the parse function (the one that takes a `slice` object), add after the `terminalFontSize` line:

```ts
    userBandSizePx:
      typeof slice.userBandSizePx === 'number' && Number.isFinite(slice.userBandSizePx)
        ? slice.userBandSizePx
        : undefined,
```

In the serialize function (the one that builds the persisted slice from `state`), add `userBandSizePx: state.userBandSizePx` alongside `terminalFontSize: state.terminalFontSize`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/office/panel/panelTypes.ts webview-ui/src/office/panel/panelPersistence.ts
git commit -m "panel: add userBandSizePx to persisted state"
```

## Task B3: Failing test for `computePanelBand` override + clamp

**Files:**

- Modify: `webview-ui/test/panel-layout.test.ts`

- [ ] **Step 1: Add tests**

In `webview-ui/test/panel-layout.test.ts`, add at the bottom (use the existing `baseState` helper):

```ts
test('bottom open: userBandSizePx overrides default', () => {
  const b = computePanelBand(baseState({ panelOpen: true, userBandSizePx: 350 }));
  assert.equal(b.mode, PanelMode.OPEN);
  assert.equal(b.bandSize, 350);
});

test('bottom open: userBandSizePx clamps to MIN', () => {
  const b = computePanelBand(baseState({ panelOpen: true, userBandSizePx: 50 }));
  assert.equal(b.bandSize, 240); // PANEL_USER_MIN_PX
});

test('bottom open: userBandSizePx clamps to max (viewportHeight - reserve)', () => {
  const b = computePanelBand(
    baseState({ panelOpen: true, userBandSizePx: 9999, viewportHeight: 800 }),
  );
  assert.equal(b.bandSize, 800 - 200); // viewportHeight - PANEL_BOTTOM_USER_MAX_RESERVE
});

test('right open: userBandSizePx applies on side panel', () => {
  const b = computePanelBand(
    baseState({ panelOpen: true, panelPosition: PanelPosition.RIGHT, userBandSizePx: 500 }),
  );
  assert.equal(b.bandSize, 500);
  assert.equal(b.canvasW, 1280 - 500);
});

test('right open: userBandSizePx clamps to viewportWidth - side reserve', () => {
  const b = computePanelBand(
    baseState({
      panelOpen: true,
      panelPosition: PanelPosition.RIGHT,
      userBandSizePx: 9999,
      viewportWidth: 1280,
    }),
  );
  assert.equal(b.bandSize, 1280 - 360); // viewportWidth - PANEL_SIDE_USER_MAX_RESERVE
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm run test:webview -- panel-layout`
Expected: FAIL — `computePanelBand` doesn't honor `userBandSizePx` yet.

- [ ] **Step 3: Commit failing test**

```bash
git add webview-ui/test/panel-layout.test.ts
git commit -m "test: failing panel-layout tests for userBandSizePx override"
```

## Task B4: Implement override + clamp in `computePanelBand`

**Files:**

- Modify: `webview-ui/src/office/panel/panelLayout.ts`

- [ ] **Step 1: Add helper + use it**

In `panelLayout.ts`, add the following at the top of the file's body (after imports):

```ts
import {
  MIN_PANEL_VIEWPORT_PX_HORIZONTAL,
  MIN_PANEL_VIEWPORT_PX_VERTICAL,
  PANEL_BOTTOM_OPEN_MAX_PX,
  PANEL_BOTTOM_OPEN_RATIO,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_BOTTOM_USER_MAX_RESERVE,
  PANEL_SIDE_OPEN_MAX_PX,
  PANEL_SIDE_OPEN_RATIO,
  PANEL_SIDE_PEEK_PX,
  PANEL_SIDE_RAIL_PX,
  PANEL_SIDE_USER_MAX_RESERVE,
  PANEL_USER_MIN_PX,
} from '../../constants.js';
```

(Replace the existing import block with this one — only `PANEL_BOTTOM_USER_MAX_RESERVE`, `PANEL_SIDE_USER_MAX_RESERVE`, and `PANEL_USER_MIN_PX` are new.)

Add this helper above `computePanelBand`:

```ts
function userBandClamp(
  userBandSizePx: number,
  horizontal: boolean,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const max = horizontal
    ? viewportHeight - PANEL_BOTTOM_USER_MAX_RESERVE
    : viewportWidth - PANEL_SIDE_USER_MAX_RESERVE;
  return Math.max(PANEL_USER_MIN_PX, Math.min(userBandSizePx, max));
}
```

Modify the `effectivelyOpen` branch in `computePanelBand`:

```ts
  if (effectivelyOpen) {
    mode = PanelMode.OPEN;
    if (state.userBandSizePx != null) {
      bandSize = userBandClamp(state.userBandSizePx, horizontal, viewportWidth, viewportHeight);
    } else {
      bandSize = horizontal ? bottomOpenSize(viewportHeight) : sideOpenSize(viewportWidth);
    }
  } else {
```

- [ ] **Step 2: Run tests, verify passing**

Run: `npm run test:webview -- panel-layout`
Expected: PASS (all cases, old and new).

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/panel/panelLayout.ts
git commit -m "panel: computePanelBand honors userBandSizePx with clamp"
```

## Task B5: Splitter component

**Files:**

- Create: `webview-ui/src/office/panel/Splitter.tsx`

- [ ] **Step 1: Write the component**

Create `webview-ui/src/office/panel/Splitter.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react';
import { isHorizontalAxis, PanelPosition } from './panelTypes.js';

interface SplitterProps {
  panelPosition: PanelPosition;
  /** Current bandSize in px (used as the drag base). */
  bandSize: number;
  /** Called with the new desired bandSize (unclamped — `computePanelBand` clamps). */
  onResize: (next: number) => void;
  /** Called on double-click to reset to the viewport-derived default. */
  onReset: () => void;
}

export function Splitter({ panelPosition, bandSize, onResize, onReset }: SplitterProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  const dragRef = useRef<{ startCoord: number; startBand: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        startCoord: horizontal ? e.clientY : e.clientX,
        startBand: bandSize,
      };
    },
    [horizontal, bandSize],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const coord = horizontal ? e.clientY : e.clientX;
      // For bottom panel: dragging up (negative delta) grows the band → invert sign.
      // For right panel: dragging left (negative delta) grows the band → invert sign.
      // For left panel: dragging right (positive delta) grows the band → keep sign.
      let delta = coord - d.startCoord;
      if (panelPosition === PanelPosition.BOTTOM || panelPosition === PanelPosition.RIGHT) {
        delta = -delta;
      }
      onResize(d.startBand + delta);
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [horizontal, panelPosition, onResize]);

  const style: React.CSSProperties = horizontal
    ? {
        position: 'absolute',
        top: -2,
        left: 0,
        right: 0,
        height: 4,
        cursor: 'ns-resize',
        zIndex: 10,
      }
    : {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 4,
        cursor: 'ew-resize',
        zIndex: 10,
        ...(panelPosition === PanelPosition.LEFT ? { right: -2 } : { left: -2 }),
      };

  return (
    <div
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    />
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/panel/Splitter.tsx
git commit -m "Splitter: drag handle component for panel band resize"
```

## Task B6: Wire `Splitter` into `OfficePanel`

**Files:**

- Modify: `webview-ui/src/office/panel/OfficePanel.tsx`

- [ ] **Step 1: Add props for resize callbacks**

In `OfficePanel.tsx`, extend `OfficePanelProps`:

```ts
interface OfficePanelProps {
  agents: AgentSummary[];
  state: PanelState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
  ptyBackedByAgent: Record<number, boolean>;
  ptyEventBus: PtyEventBus;
  onSetUserBandSizePx: (px: number | undefined) => void;
}
```

(Add `onSetUserBandSizePx` to the destructuring at the top of the function body.)

- [ ] **Step 2: Mount `Splitter` in OPEN mode**

Add the import at the top:

```ts
import { Splitter } from './Splitter.js';
```

Modify the OPEN-mode JSX (inside the `return` block, where the outer wrapper sets `display: 'flex'`) so the wrapper is `position: 'relative'`, and add `<Splitter/>` inside it:

```tsx
  return (
    <div
      style={{
        ...outerStyle,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <Splitter
        panelPosition={state.panelPosition}
        bandSize={band.bandSize}
        onResize={(next) => onSetUserBandSizePx(next)}
        onReset={() => onSetUserBandSizePx(undefined)}
      />
      <PanelHeader
        ...
```

(The rest of the JSX is unchanged.)

- [ ] **Step 3: Wire the prop from `App.tsx`**

In `webview-ui/src/App.tsx`, find where `<OfficePanel ... />` is rendered. Pass:

```tsx
onSetUserBandSizePx={(px) => setPanelState((s) => ({ ...s, userBandSizePx: px }))}
```

(Adapt to the actual state-update helper used; if `setPanelState` doesn't exist with that signature, use whatever pattern `setTerminalFontSize` follows. Search for `terminalFontSize` in `App.tsx` to find the matching pattern.)

- [ ] **Step 4: Build webview**

Run: `cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/panel/OfficePanel.tsx webview-ui/src/App.tsx
git commit -m "OfficePanel: mount Splitter on outer edge for user resize"
```

## Task B7: 0.5 zoom steps

**Files:**

- Modify: `webview-ui/src/constants.ts`
- Modify: `webview-ui/src/components/ZoomControls.tsx`
- Modify: `webview-ui/src/office/toolUtils.ts` (or wherever `defaultZoom` lives — confirm via grep)

- [ ] **Step 1: Replace integer min/max with steps array**

In `webview-ui/src/constants.ts`, keep `ZOOM_MIN` and `ZOOM_MAX` for compatibility (`ZOOM_MIN = 1`, `ZOOM_MAX = 10`) but add:

```ts
/** Valid zoom values in order. Half-steps allowed; the integer-DPR invariant
 *  is intentionally relaxed at half-steps (may shimmer at DPR<2 — accepted tradeoff). */
export const ZOOM_STEPS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10,
] as const;
```

- [ ] **Step 2: Step through array in ZoomControls**

In `webview-ui/src/components/ZoomControls.tsx`, replace the `+`/`-` click handlers. Add import:

```ts
import { ZOOM_STEPS } from '../constants.js';
```

Replace `onClick={() => onZoomChange(zoom + 1)}` (the `+` button) with:

```tsx
onClick={() => {
  const idx = ZOOM_STEPS.findIndex((z) => z >= zoom);
  const next = idx === -1 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[Math.min(idx + 1, ZOOM_STEPS.length - 1)];
  onZoomChange(next);
}}
```

Replace `onClick={() => onZoomChange(zoom - 1)}` (the `-` button) with:

```tsx
onClick={() => {
  // largest step strictly less than current
  let next: number = ZOOM_STEPS[0];
  for (const z of ZOOM_STEPS) {
    if (z < zoom) next = z;
    else break;
  }
  onZoomChange(next);
}}
```

Replace `const minDisabled = zoom <= ZOOM_MIN;` with `const minDisabled = zoom <= ZOOM_STEPS[0];`.
Replace `const maxDisabled = zoom >= ZOOM_MAX;` with `const maxDisabled = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];`.

(Remove `ZOOM_MIN`/`ZOOM_MAX` from the import if they're now unused.)

The label `{zoom}x` works at line ~67 — half-step zooms will show as `2.5x` etc., which is fine.

- [ ] **Step 3: Snap `defaultZoom` to nearest step**

Run: `grep -n "defaultZoom\|export function defaultZoom" webview-ui/src/office/toolUtils.ts`

Modify `defaultZoom()` so its return value is snapped to the nearest `ZOOM_STEPS` entry:

```ts
import { ZOOM_STEPS, ZOOM_DEFAULT_DPR_FACTOR } from '../constants.js';

export function defaultZoom(): number {
  const raw = Math.round(ZOOM_DEFAULT_DPR_FACTOR * window.devicePixelRatio);
  // Snap to nearest ZOOM_STEPS value.
  let best = ZOOM_STEPS[0];
  let bestDelta = Math.abs(raw - best);
  for (const z of ZOOM_STEPS) {
    const d = Math.abs(raw - z);
    if (d < bestDelta) {
      best = z;
      bestDelta = d;
    }
  }
  return best;
}
```

(Adjust the import path if `toolUtils` is in a different directory than the constants reference suggests; the existing file shows the import idiom.)

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/constants.ts webview-ui/src/components/ZoomControls.tsx webview-ui/src/office/toolUtils.ts
git commit -m "zoom: add 0.5 increments via ZOOM_STEPS array"
```

## Task B8: Manual verification — splitter + zoom

**Files:** None.

- [ ] **Step 1: Build + launch**

Run: `npm run build`, then F5 in VS Code to launch the Extension Dev Host.

- [ ] **Step 2: Splitter drag (bottom panel)**

Open Pixel Agents → spawn an agent → with the panel on the bottom (Settings → Panel position → Bottom), grab the top edge of the panel and drag up/down. The panel resizes live and the office canvas reflows.

- [ ] **Step 3: Double-click resets**

Double-click the splitter handle. Panel reverts to viewport-ratio default size.

- [ ] **Step 4: Splitter on right + left**

Repeat steps 2-3 with the panel on the right, then left.

- [ ] **Step 5: Zoom through half-steps**

Use the zoom +/- buttons. Verify each press lands on `1, 1.5, 2, 2.5, 3, ...` and label shows correctly. Visually inspect rendering at `1.5` and `2.5` on the current display — note any shimmer for the post-ship review.

- [ ] **Step 6: Commit marker**

```bash
git commit --allow-empty -m "Part B complete: splitter drag + 0.5 zoom"
```

---

# Part C — Terminal font customization

## Task C1: Bundle the four monospace fonts

**Files:**

- Create: `webview-ui/public/fonts/terminal/fira-code.woff2`
- Create: `webview-ui/public/fonts/terminal/jetbrains-mono.woff2`
- Create: `webview-ui/public/fonts/terminal/cascadia-mono.woff2`
- Create: `webview-ui/public/fonts/terminal/ibm-plex-mono.woff2`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p webview-ui/public/fonts/terminal
```

- [ ] **Step 2: Download each font (regular weight, woff2)**

Use the upstream OFL/SIL-licensed Regular variants:

```bash
curl -L -o webview-ui/public/fonts/terminal/fira-code.woff2 \
  https://cdn.jsdelivr.net/gh/tonsky/FiraCode/distr/woff2/FiraCode-Regular.woff2
curl -L -o webview-ui/public/fonts/terminal/jetbrains-mono.woff2 \
  https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono/fonts/webfonts/JetBrainsMono-Regular.woff2
curl -L -o webview-ui/public/fonts/terminal/cascadia-mono.woff2 \
  https://cdn.jsdelivr.net/gh/microsoft/cascadia-code/sources/woff2/CascadiaMono-Regular.woff2
curl -L -o webview-ui/public/fonts/terminal/ibm-plex-mono.woff2 \
  https://cdn.jsdelivr.net/gh/IBM/plex/IBM-Plex-Mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2
```

- [ ] **Step 3: Verify each file exists and is non-empty**

```bash
ls -la webview-ui/public/fonts/terminal/
```

Expected: all four `.woff2` files, each at least 30KB.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/public/fonts/terminal/
git commit -m "fonts: bundle Fira Code, JetBrains Mono, Cascadia Mono, IBM Plex Mono"
```

## Task C2: `@font-face` declarations

**Files:**

- Modify: `webview-ui/src/index.css`

- [ ] **Step 1: Add declarations**

In `webview-ui/src/index.css`, add at the top (after any existing `@font-face` for FS Pixel Sans):

```css
@font-face {
  font-family: 'Fira Code';
  src: url('/fonts/terminal/fira-code.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('/fonts/terminal/jetbrains-mono.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'Cascadia Mono';
  src: url('/fonts/terminal/cascadia-mono.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/terminal/ibm-plex-mono.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
  font-style: normal;
}
```

- [ ] **Step 2: Build webview**

Run: `cd webview-ui && npm run build && cd ..`
Expected: PASS. Vite copies `public/fonts/terminal/` into `dist/` automatically.

- [ ] **Step 3: Verify font files made it to dist**

Run: `ls -la webview-ui/dist/fonts/terminal/`
Expected: all four `.woff2` files present.

- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/index.css
git commit -m "css: declare bundled terminal monospace fonts"
```

## Task C3: Add global state keys + messages

**Files:**

- Modify: `src/constants.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Add global state keys**

In `src/constants.ts`, add near the existing `GLOBAL_KEY_*` declarations:

```ts
export const GLOBAL_KEY_TERMINAL_FONT_FAMILY = 'pixel-agents.terminalFontFamily';
export const GLOBAL_KEY_TERMINAL_LINE_HEIGHT = 'pixel-agents.terminalLineHeight';
```

- [ ] **Step 2: Handle setters in provider**

In `src/PixelAgentsViewProvider.ts`, locate the `setUsePtyTerminal` message handler (around line 547). Add two new sibling handlers:

```ts
    } else if (message.type === 'setTerminalFontFamily') {
      const value = typeof message.value === 'string' ? message.value : 'monospace';
      this.context.globalState.update(GLOBAL_KEY_TERMINAL_FONT_FAMILY, value);
    } else if (message.type === 'setTerminalLineHeight') {
      const value = typeof message.value === 'number' && Number.isFinite(message.value) ? message.value : 1.0;
      this.context.globalState.update(GLOBAL_KEY_TERMINAL_LINE_HEIGHT, value);
```

- [ ] **Step 3: Include both in `settingsLoaded`**

Locate the `settingsLoaded` broadcast in `webviewReady` handling (around line 657). Add to the payload right after `usePtyTerminal`:

```ts
        terminalFontFamily: this.context.globalState.get<string>(
          GLOBAL_KEY_TERMINAL_FONT_FAMILY,
          'monospace',
        ),
        terminalLineHeight: this.context.globalState.get<number>(
          GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
          1.0,
        ),
```

Add the imports at the top of the file:

```ts
import { GLOBAL_KEY_TERMINAL_FONT_FAMILY, GLOBAL_KEY_TERMINAL_LINE_HEIGHT } from './constants.js';
```

(Merge into the existing constants import block.)

- [ ] **Step 4: Type-check + build extension**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/PixelAgentsViewProvider.ts
git commit -m "settings: persist terminalFontFamily + terminalLineHeight in globalState"
```

## Task C4: Receive new fields in webview state

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`

- [ ] **Step 1: Track new state**

In `webview-ui/src/hooks/useExtensionMessages.ts`, find the state declarations near `usePtyTerminal`. Add:

```ts
const [terminalFontFamily, setTerminalFontFamilyState] = useState('monospace');
const [terminalLineHeight, setTerminalLineHeightState] = useState(1.0);
```

- [ ] **Step 2: Read from settingsLoaded**

Find the `settingsLoaded` handler (search for `usePtyTerminal` near a `msg.type === 'settingsLoaded'` branch). Add:

```ts
if (typeof msg.terminalFontFamily === 'string') {
  setTerminalFontFamilyState(msg.terminalFontFamily as string);
}
if (typeof msg.terminalLineHeight === 'number') {
  setTerminalLineHeightState(msg.terminalLineHeight as number);
}
```

- [ ] **Step 3: Expose setters + values to App**

In the hook's return, add `terminalFontFamily`, `terminalLineHeight`, `setTerminalFontFamily`, `setTerminalLineHeight`. The setter implementations send the message to the extension:

```ts
const setTerminalFontFamily = (v: string) => {
  setTerminalFontFamilyState(v);
  vscode.postMessage({ type: 'setTerminalFontFamily', value: v });
};
const setTerminalLineHeight = (v: number) => {
  setTerminalLineHeightState(v);
  vscode.postMessage({ type: 'setTerminalLineHeight', value: v });
};
```

Add these names to the hook's interface and return object.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p webview-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "webview: track terminalFontFamily + terminalLineHeight in extension messages"
```

## Task C5: Settings modal — Terminal section

**Files:**

- Modify: `webview-ui/src/components/SettingsModal.tsx`
- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Extend `SettingsModalProps`**

In `SettingsModal.tsx`, add to the props interface:

```ts
  terminalFontFamily: string;
  onSetTerminalFontFamily: (v: string) => void;
  terminalLineHeight: number;
  onSetTerminalLineHeight: (v: number) => void;
```

- [ ] **Step 2: Render the controls**

Add this block immediately after the "Use in-panel terminal" checkbox in `SettingsModal.tsx`:

```tsx
<div className="flex flex-col gap-2 py-3 px-10">
  <span className="text-xs">Terminal font family</span>
  <select
    value={terminalFontFamily}
    onChange={(e) => onSetTerminalFontFamily(e.target.value)}
    className="bg-[#1e1e2e] border-2 border-[#0a0a14] text-xs px-2 py-1 cursor-pointer"
  >
    <option value="monospace">System default</option>
    <option value="'Fira Code', monospace">Fira Code</option>
    <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
    <option value="'Cascadia Mono', monospace">Cascadia Mono</option>
    <option value="'IBM Plex Mono', monospace">IBM Plex Mono</option>
  </select>
</div>

<div className="flex flex-col gap-2 py-3 px-10">
  <span className="text-xs">Terminal line height</span>
  <div className="flex items-center gap-3">
    <button
      type="button"
      onClick={() =>
        onSetTerminalLineHeight(Math.max(0.8, Math.round((terminalLineHeight - 0.1) * 10) / 10))
      }
      className="bg-[#1e1e2e] border-2 border-[#0a0a14] text-xs px-2 cursor-pointer"
      disabled={terminalLineHeight <= 0.8}
    >
      −
    </button>
    <span className="text-xs w-10 text-center tabular-nums">{terminalLineHeight.toFixed(1)}</span>
    <button
      type="button"
      onClick={() =>
        onSetTerminalLineHeight(Math.min(2.0, Math.round((terminalLineHeight + 0.1) * 10) / 10))
      }
      className="bg-[#1e1e2e] border-2 border-[#0a0a14] text-xs px-2 cursor-pointer"
      disabled={terminalLineHeight >= 2.0}
    >
      +
    </button>
  </div>
</div>
```

- [ ] **Step 3: Pass new props from `App.tsx`**

In `App.tsx`, find the existing `<SettingsModal ... />` call and add:

```tsx
terminalFontFamily = { terminalFontFamily };
onSetTerminalFontFamily = { setTerminalFontFamily };
terminalLineHeight = { terminalLineHeight };
onSetTerminalLineHeight = { setTerminalLineHeight };
```

(Pull these from the `useExtensionMessages()` return; merge with the existing destructure.)

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/components/SettingsModal.tsx webview-ui/src/App.tsx
git commit -m "settings: Terminal font family dropdown + line-height stepper"
```

## Task C6: Apply font + line-height in `TerminalPane`

**Files:**

- Modify: `webview-ui/src/office/panel/TerminalPane.tsx`

- [ ] **Step 1: Add props**

Extend `TerminalPaneProps`:

```ts
interface TerminalPaneProps {
  agentId: number;
  agentName: string | null;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  bus: PtyEventBus;
}
```

Destructure `fontFamily` and `lineHeight` at the function signature.

- [ ] **Step 2: Pass options to xterm**

Locate the `new Terminal({...})` constructor call. Add `fontFamily` and `lineHeight` to the options object:

```ts
const term = new Terminal({
  fontSize,
  fontFamily,
  lineHeight,
  // ...existing options
});
```

- [ ] **Step 3: React to changes**

Add a `useEffect` after the existing font-size effect (if one exists; otherwise add it):

```ts
useEffect(() => {
  const term = termRef.current;
  const fit = fitRef.current;
  if (!term || !fit) return;
  term.options.fontFamily = fontFamily;
  term.options.lineHeight = lineHeight;
  try {
    fit.fit();
  } catch {
    /* container may be 0x0 mid-mount; ignore */
  }
  const cols = term.cols;
  const rows = term.rows;
  vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });
}, [agentId, fontFamily, lineHeight]);
```

- [ ] **Step 4: Pass props from `OfficePanel`**

In `webview-ui/src/office/panel/OfficePanel.tsx`, locate where `<TerminalPane ... />` is rendered. Add:

```tsx
fontFamily={state.terminalFontFamily ?? 'monospace'}
lineHeight={state.terminalLineHeight ?? 1.0}
```

Wait — `terminalFontFamily` and `terminalLineHeight` aren't on `PanelState`. They live in `useExtensionMessages` state. Pass them through `App.tsx` instead, by adding the fields to the `<OfficePanel/>` call.

Add to `OfficePanelProps`:

```ts
terminalFontFamily: string;
terminalLineHeight: number;
```

And destructure them; pass them down to `<TerminalPane/>`.

In `App.tsx`, pass them when rendering `<OfficePanel/>`:

```tsx
terminalFontFamily = { terminalFontFamily };
terminalLineHeight = { terminalLineHeight };
```

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit -p webview-ui && cd webview-ui && npm run build && cd ..`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/office/panel/TerminalPane.tsx webview-ui/src/office/panel/OfficePanel.tsx webview-ui/src/App.tsx
git commit -m "TerminalPane: apply fontFamily + lineHeight from settings"
```

## Task C7: Manual verification — fonts

**Files:** None.

- [ ] **Step 1: Build + launch**

Run: `npm run build`, F5 in VS Code.

- [ ] **Step 2: Enable in-panel terminal**

Settings → Use in-panel terminal → ON. Spawn a new agent (existing agents stay on VS Code terminal).

- [ ] **Step 3: Cycle font families**

Settings → Terminal font family → click each option: System default, Fira Code, JetBrains Mono, Cascadia Mono, IBM Plex Mono. The pty terminal re-renders with the selected font each time. No layout shift, no flash of unstyled text.

- [ ] **Step 4: Change line height**

Settings → Terminal line height → `−` / `+`. Range 0.8 to 2.0, step 0.1. Pty terminal re-flows; pty `cols`/`rows` re-reported (verify by watching the terminal output — text doesn't truncate at the right edge).

- [ ] **Step 5: Reload preserves**

Reload Extension Dev Host. Settings retain the previously chosen font family + line height.

- [ ] **Step 6: Commit marker**

```bash
git commit --allow-empty -m "Part C complete: terminal font customization"
```

---

# Final Verification

## Task F1: Full test suite

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: PASS (all suites — extension, server, webview).

- [ ] **Step 2: Lint**

Run: `npm run lint` (if present in scripts; otherwise skip)
Expected: PASS / no new warnings.

- [ ] **Step 3: Type-check both sides**

Run: `npx tsc --noEmit && npx tsc --noEmit -p webview-ui`
Expected: PASS.

## Task F2: Smoke run

- [ ] **Step 1: Fresh build**

```bash
npm run build
```

- [ ] **Step 2: Full manual flow**

Launch Extension Dev Host (F5). In sequence:

1. Spawn pty agent (Settings → Use in-panel terminal ON, then `+ Agent`).
2. `/rename Test1` in the terminal — label updates.
3. Drag splitter — terminal reflows live.
4. Toggle zoom 1 → 1.5 → 2 → 2.5 — character renders at each step.
5. Change terminal font to Fira Code, line height 1.2 — terminal re-renders.
6. Reload the Extension Dev Host — `Test1` persists, splitter position persists, font + line height persist.

All steps work without console errors.

- [ ] **Step 3: Commit final marker + push**

```bash
git commit --allow-empty -m "Terminal experience polish ready for review"
git push -u origin 2026-05-12-terminal-polish
```

---

## Out of scope (next plans)

- Manual rename UI (inline edit on the character / panel header). Deferred — see spec.
- Settings menu redesign — covered by `docs/superpowers/plans/2026-05-12-settings-redesign.md`.
- Zoom snap-to-integer at low DPR if half-step blur is unusable in practice — follow-up after live use.
- Per-agent terminal font.

## Self-Review Checklist

- [x] **Spec coverage**: Each of the spec's three items (rename, splitter+zoom, font) maps to a Part (A, B, C). State & Persistence table fields all have a task that creates them. Out-of-scope items match.
- [x] **No placeholders**: All `TODO`/`TBD` removed from spec are reflected in concrete code in plan steps.
- [x] **Type consistency**: `customTitle` used throughout; `userBandSizePx` used throughout; `ZOOM_STEPS` used in both controls and `defaultZoom`. Message names (`agentRenamed`, `setTerminalFontFamily`, `setTerminalLineHeight`) consistent between sender and receiver. Function name `computePanelBand` (verified against current code, not `computeBand`).
- [x] **Tests**: Real test code in Tasks A3 and B3. Type-check passes between every commit.
