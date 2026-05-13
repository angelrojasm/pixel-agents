# Visual Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the panel chrome up to the established pixel-art vocabulary — 2px borders, sharp corners, hover affordances, pixel-styled scrollbar, visible splitter grip, focused-agent identity strip in the header.

**Architecture:** Visual-only bundle. No new state, no new persisted fields, no new messages. New utility classes go in `webview-ui/src/index.css`. Existing `PANEL_*` color tokens and `--color-*` CSS variables are reused. `AgentCell` gains a required `panelPosition` prop threaded through `OfficePanel → PanelHeader / LiteRail`. The xterm viewport scrollbar is styled by a global `.xterm-viewport` selector — no class wiring inside `TerminalPane`.

**Tech Stack:** React + TypeScript (Vite), Tailwind v4 (utility classes layered via `@layer components` in `index.css`), xterm.js v5.

**Spec:** `docs/superpowers/specs/2026-05-13-visual-chrome-design.md`

**Testing approach:** Visual chrome is presentational — no new unit tests. Existing `panel-layout.test.ts` continues to pass unchanged (no dimensions or state altered). Each task ends with `npm run lint` + `npx tsc --noEmit -p webview-ui` to catch regressions; manual QA happens in Task 7 inside the Extension Dev Host.

---

## File Structure

| File                                           | Responsibility                                                      | Task |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---- |
| `webview-ui/src/index.css`                     | Global pixel-art utility classes (scrollbar, hover, splitter grip). | 1    |
| `webview-ui/src/office/panel/Splitter.tsx`     | Drag handle + hover-only grip indicator.                            | 2    |
| `webview-ui/src/office/panel/TerminalPane.tsx` | xterm wrapper + 2px frame around the terminal viewport.             | 3    |
| `webview-ui/src/office/panel/AgentCell.tsx`    | Agent button cell — variants, focus, hover, focus-edge-drop.        | 4    |
| `webview-ui/src/office/panel/PanelHeader.tsx`  | Header bar — identity strip + tab strip + hide button.              | 5    |
| `webview-ui/src/office/panel/LiteRail.tsx`     | Collapsed-mode rail strip — overflow scroll + hide button.          | 6    |

No new files. No file moves. No renames.

---

## Task 1: CSS utility classes

**Files:**

- Modify: `webview-ui/src/index.css:103-118` (`@layer components` block)

- [ ] **Step 1: Read the current `@layer components` block to find the insertion point**

Read: `webview-ui/src/index.css`

The existing block contains `.pixel-panel`, `.carousel`, `.pixel-pulse`. The new rules go at the end of the block, before the closing `}` on line 118.

- [ ] **Step 2: Add `.pixel-scrollbar` and `.xterm-viewport` shared scrollbar rules**

Append to the `@layer components` block in `webview-ui/src/index.css` (before the closing `}`):

```css
/* Pixel-art scrollbar — applied to panel overflow regions and xterm's DOM viewport */
.pixel-scrollbar,
.xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}
.pixel-scrollbar::-webkit-scrollbar,
.xterm-viewport::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.pixel-scrollbar::-webkit-scrollbar-track,
.xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.pixel-scrollbar::-webkit-scrollbar-thumb,
.xterm-viewport::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 0;
}
.pixel-scrollbar::-webkit-scrollbar-thumb:hover,
.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: var(--color-accent);
}
```

- [ ] **Step 3: Add `.panel-cell-hover` and `.panel-icon-hover` hover utilities**

Append immediately after the scrollbar rules, still inside `@layer components`:

```css
/* Hover affordances for panel chrome */
.panel-cell-hover {
  transition: background-color 80ms ease-out;
}
.panel-cell-hover:hover {
  background-color: var(--color-btn-hover) !important;
}

.panel-icon-hover {
  transition: color 80ms ease-out;
}
.panel-icon-hover:hover {
  color: var(--color-text) !important;
}
```

The `!important` overrides `AgentCell`'s inline `background: PANEL_BG_CELL` and the buttons' inline `color: PANEL_MUTED`. Without it, CSS specificity loses to inline styles. Scoped to two utility classes, so the impact is contained.

- [ ] **Step 4: Add `.panel-splitter` grip-fade rule**

Append immediately after the hover utilities, still inside `@layer components`:

```css
/* Splitter grip indicator — hidden until hover */
.panel-splitter span {
  opacity: 0;
  transition: opacity 120ms ease-out;
}
.panel-splitter:hover span {
  opacity: 1;
}
```

- [ ] **Step 5: Run lint to confirm CSS parses cleanly**

Run: `npm run lint`
Expected: PASS (no errors). Tailwind v4 with `@layer components` accepts vanilla CSS rules.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/index.css
git commit -m "$(cat <<'EOF'
visual-chrome: add pixel scrollbar + hover + splitter-grip utilities

Adds .pixel-scrollbar (shared with .xterm-viewport), .panel-cell-hover,
.panel-icon-hover, and the .panel-splitter span fade rule to
index.css's @layer components block. All four classes are consumed
by later tasks in the visual-chrome bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Splitter grip indicator

**Files:**

- Modify: `webview-ui/src/office/panel/Splitter.tsx:75-84`

- [ ] **Step 1: Read the current Splitter render to confirm structure**

Read: `webview-ui/src/office/panel/Splitter.tsx`

The current return renders a single `<div>` with `style`, `onMouseDown`, `onDoubleClick`, `role`, `aria-orientation`. The grip goes inside it as an absolutely-positioned `<span>`.

- [ ] **Step 2: Import `PANEL_BORDER` and add the grip**

Add `PANEL_BORDER` to the imports at the top of `webview-ui/src/office/panel/Splitter.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react';

import { PANEL_BORDER } from '../../constants.js';
import { isHorizontalAxis, PanelPosition } from './panelTypes.js';
```

Replace the return block (lines 75-84 in the current file) with:

```tsx
const gripStyle: React.CSSProperties = horizontal
  ? {
      width: 12,
      height: 2,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  : {
      width: 2,
      height: 12,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };

return (
  <div
    style={style}
    onMouseDown={onMouseDown}
    onDoubleClick={onReset}
    role="separator"
    aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    className="panel-splitter"
  >
    <span aria-hidden style={{ position: 'absolute', background: PANEL_BORDER, ...gripStyle }} />
  </div>
);
```

- [ ] **Step 3: Run typecheck**

Run: `cd webview-ui && npx tsc --noEmit && cd ..`
Expected: PASS (no errors).

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/panel/Splitter.tsx
git commit -m "$(cat <<'EOF'
visual-chrome: Splitter shows 12x2 grip on hover

Adds an absolutely-positioned span inside the splitter handle.
Opacity 0 by default, fades to 1 on hover via the .panel-splitter
rule in index.css. Communicates draggability without claiming
permanent visual weight.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TerminalPane frame

**Files:**

- Modify: `webview-ui/src/office/panel/TerminalPane.tsx:156-168`

- [ ] **Step 1: Read the current outer wrapper to confirm structure**

Read: `webview-ui/src/office/panel/TerminalPane.tsx`

The current outer `<div>` has `padding: 4`, `background: PANEL_BG_CHROME`, and no borders. The xterm container is the inner `<div ref={containerRef}>`.

- [ ] **Step 2: Add `PANEL_BORDER` to imports**

Update the imports near the top of `webview-ui/src/office/panel/TerminalPane.tsx`:

```tsx
import { PANEL_BG_CHROME, PANEL_BORDER } from '../../constants.js';
```

- [ ] **Step 3: Add 2px borders on left/right/bottom and drop padding to 2**

Replace the existing return block (lines 156-168) with:

```tsx
return (
  <div
    style={{
      flex: '1 1 auto',
      minHeight: 0,
      background: PANEL_BG_CHROME,
      padding: 2,
      borderLeft: `2px solid ${PANEL_BORDER}`,
      borderRight: `2px solid ${PANEL_BORDER}`,
      borderBottom: `2px solid ${PANEL_BORDER}`,
    }}
    aria-label={agentName ? `Terminal for ${agentName}` : 'Terminal'}
  >
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  </div>
);
```

- [ ] **Step 4: Run typecheck**

Run: `cd webview-ui && npx tsc --noEmit && cd ..`
Expected: PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Run unit tests to confirm no regression**

Run: `npm run test:webview`
Expected: PASS (panel layout tests unchanged — terminal pane padding is not asserted).

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/panel/TerminalPane.tsx
git commit -m "$(cat <<'EOF'
visual-chrome: 2px PANEL_BORDER frame around xterm viewport

Adds borders on the three edges of the terminal pane that touch the
outer panel band (left, right, bottom). Top edge is already separated
from the header by the header's own border. Drops inner padding from
4px to 2px to match the pixel-art density used elsewhere in the
webview.

The xterm scrollbar is styled by the global .xterm-viewport rule
in index.css — no class wiring needed here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: AgentCell panel-position-aware + thread prop

**Files:**

- Modify: `webview-ui/src/office/panel/AgentCell.tsx` (full rewrite of the props + render body)
- Modify: `webview-ui/src/office/panel/PanelHeader.tsx` (add `panelPosition` to AgentCell call)
- Modify: `webview-ui/src/office/panel/LiteRail.tsx` (add `panelPosition` to AgentCell call)

This task wires the new `panelPosition` prop end-to-end. Identity-strip and scrollbar-class changes come in Tasks 5 and 6.

- [ ] **Step 1: Read the current `AgentCell.tsx` and consumers**

Read all three files to confirm the existing prop shape and call sites:

- `webview-ui/src/office/panel/AgentCell.tsx`
- `webview-ui/src/office/panel/PanelHeader.tsx`
- `webview-ui/src/office/panel/LiteRail.tsx`

- [ ] **Step 2: Update `AgentCell.tsx` — add prop, helper, conditional border drop, hover class**

Replace the entire body of `webview-ui/src/office/panel/AgentCell.tsx` with:

```tsx
import {
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BORDER,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
  PANEL_WAITING,
} from '../../constants.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';

interface AgentCellProps {
  agent: AgentSummary;
  variant: 'rail' | 'rail-side' | 'tab';
  panelPosition: PanelPosition;
  isFocused: boolean;
  onClick: () => void;
}

const SIZES = {
  rail: { width: 72, height: 20, fontSize: 10 },
  'rail-side': { width: 24, height: 24, fontSize: 0 },
  tab: { width: 56, height: 16, fontSize: 9 },
} as const;

const STATUS_COLOR: Record<AgentSummary['status'], string> = {
  active: PANEL_ACCENT,
  waiting: PANEL_WAITING,
  idle: PANEL_MUTED,
};

type DropEdge = 'top' | 'right' | 'bottom' | 'left' | null;

function focusDropEdge(
  variant: 'rail' | 'rail-side' | 'tab',
  panelPosition: PanelPosition,
): DropEdge {
  // Only LiteRail-context variants can render focused; PanelHeader filters
  // the focused agent out of its tab/other-agent list.
  if (variant === 'rail') return 'top';
  if (variant === 'rail-side') return panelPosition === 'left' ? 'right' : 'left';
  return null;
}

export function AgentCell({ agent, variant, panelPosition, isFocused, onClick }: AgentCellProps) {
  const { width, height, fontSize } = SIZES[variant];
  const borderColor = isFocused ? PANEL_ACCENT : PANEL_BORDER;
  const isSquare = variant === 'rail-side';
  const dropEdge = isFocused ? focusDropEdge(variant, panelPosition) : null;

  const borderStyle: React.CSSProperties = {
    borderTop: dropEdge === 'top' ? 'none' : `1px solid ${borderColor}`,
    borderRight: dropEdge === 'right' ? 'none' : `1px solid ${borderColor}`,
    borderBottom: dropEdge === 'bottom' ? 'none' : `1px solid ${borderColor}`,
    borderLeft: dropEdge === 'left' ? 'none' : `1px solid ${borderColor}`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="panel-cell-hover"
      style={{
        width,
        height,
        background: PANEL_BG_CELL,
        ...borderStyle,
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

- [ ] **Step 3: Update `PanelHeader.tsx` — pass `panelPosition` to AgentCell**

Locate the `<AgentCell>` call inside the `{others.map(...)}` block (around line 93 in the current file). Replace it with:

```tsx
{
  others.map((a) => (
    <AgentCell
      key={a.id}
      agent={a}
      variant={horizontal ? 'tab' : 'rail-side'}
      panelPosition={panelPosition}
      isFocused={false}
      onClick={() => onFocusAgent(a.id)}
    />
  ));
}
```

- [ ] **Step 4: Update `LiteRail.tsx` — pass `panelPosition` to AgentCell**

Locate the `<AgentCell>` call inside the `{agents.map(...)}` block (around line 66 in the current file). Replace it with:

```tsx
{
  agents.map((a) => (
    <AgentCell
      key={a.id}
      agent={a}
      variant={variant}
      panelPosition={panelPosition}
      isFocused={a.id === focusedAgentId}
      onClick={() => onFocusAgent(a.id)}
    />
  ));
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd webview-ui && npx tsc --noEmit && cd ..`
Expected: PASS. If you see `Property 'panelPosition' is missing in type ...`, you missed one of the two call sites above — fix and re-run.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Run unit tests**

Run: `npm run test:webview`
Expected: PASS (no behavioral change).

- [ ] **Step 8: Commit**

```bash
git add webview-ui/src/office/panel/AgentCell.tsx webview-ui/src/office/panel/PanelHeader.tsx webview-ui/src/office/panel/LiteRail.tsx
git commit -m "$(cat <<'EOF'
visual-chrome: AgentCell panel-position-aware + hover + focus-edge-drop

AgentCell gains a required panelPosition prop and a focusDropEdge
helper that returns the rail edge facing the office canvas — top for
bottom-mode rail, right/left for side-mode rail (mirroring the
panel's position). When isFocused, the corresponding border is set
to none so the focused cell visually "punches through" the rail
strip toward the canvas. tab variant returns null (never focused —
PanelHeader filters the focused agent out of its tab list).

Adds className="panel-cell-hover" for the 80ms background fade.

PanelHeader + LiteRail updated to pass panelPosition through to
AgentCell. No identity-strip or scrollbar-class changes here —
those land in tasks 5 and 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: PanelHeader identity strip + hide-button hover

**Files:**

- Modify: `webview-ui/src/office/panel/PanelHeader.tsx:59-82` (focused-agent block) and line 117 (hide button)

- [ ] **Step 1: Read the current `PanelHeader.tsx`**

Read: `webview-ui/src/office/panel/PanelHeader.tsx`

The focused-agent block is the `{focused && (<div>...</div>)}` JSX between lines ~59 and ~82. The hide button is at line ~103-118.

- [ ] **Step 2: Replace the focused-agent pill with the identity strip**

Replace the `{focused && (...)}` block with:

```tsx
{
  focused && (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        height: '100%',
        background: PANEL_BG_CELL,
        ...(horizontal ? { borderBottom: `2px solid ${PANEL_ACCENT}` } : {}),
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 12,
          background: PANEL_SPRITE_PLACEHOLDER,
          flex: '0 0 auto',
        }}
      />
      <span style={{ color: PANEL_ACCENT, fontSize: 10 }}>{focused.name}</span>
    </div>
  );
}
```

Differences from the previous pill: removes the 1px `PANEL_ACCENT` border, removes the fixed 16px height (uses `height: '100%'` to fill the header thickness), increases the sprite from 8×10 to 10×12 (matches `rail-side` cell), bumps the padding to 8px horizontal, and adds the `borderBottom` accent line in bottom mode only.

- [ ] **Step 3: Add `panel-icon-hover` className to the hide button**

Locate the `<button>` for the hide action (around line 103-118). Add `className="panel-icon-hover"`:

```tsx
<button
  type="button"
  onClick={onCollapse}
  className="panel-icon-hover"
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
```

- [ ] **Step 4: Run typecheck**

Run: `cd webview-ui && npx tsc --noEmit && cd ..`
Expected: PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Run unit tests**

Run: `npm run test:webview`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/panel/PanelHeader.tsx
git commit -m "$(cat <<'EOF'
visual-chrome: PanelHeader identity strip + hide-button hover

Replaces the 1px-bordered focused-agent pill with an identity strip:
fills the full header thickness, uses PANEL_BG_CELL background, and
adds a 2px PANEL_ACCENT bottom border in bottom mode only — the
strip's bottom edge coincides with the header/terminal boundary, so
the accent line literally connects the focused agent's identity to
the terminal below. In side mode the bottom edge sits against the
other-agents column instead, so the underline is omitted there
(would imply the strip owns the other agents).

Adds panel-icon-hover className to the [hide] button for the 80ms
color fade.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: LiteRail scrollbar + hide-button hover

**Files:**

- Modify: `webview-ui/src/office/panel/LiteRail.tsx:55-90`

- [ ] **Step 1: Read the current `LiteRail.tsx`**

Read: `webview-ui/src/office/panel/LiteRail.tsx`

The overflow div is the inner `<div style={{ display: 'flex', ..., overflow: 'auto' }}>` (around lines 55-64). The hide button is the `<button>` after it (around lines 75-90).

- [ ] **Step 2: Add `pixel-scrollbar` className to the inner overflow div**

Locate the inner overflow `<div>` and add `className="pixel-scrollbar"`:

```tsx
      <div
        className="pixel-scrollbar"
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: 'center',
          gap: horizontal ? 6 : 4,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
```

- [ ] **Step 3: Add `panel-icon-hover` className to the hide button**

Locate the `<button>` for `onHideRail` (around lines 75-90). Add `className="panel-icon-hover"`:

```tsx
<button
  type="button"
  onClick={onHideRail}
  className="panel-icon-hover"
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
```

- [ ] **Step 4: Run typecheck**

Run: `cd webview-ui && npx tsc --noEmit && cd ..`
Expected: PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Run unit tests**

Run: `npm run test:webview`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/office/panel/LiteRail.tsx
git commit -m "$(cat <<'EOF'
visual-chrome: LiteRail pixel-scrollbar + hide-button hover

Applies pixel-scrollbar className to the overflow div so the rail's
scroll thumb matches the chrome aesthetic when the agent list
overflows. Adds panel-icon-hover className to the [hide] button for
the 80ms color fade.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final build + manual QA

**Files:** none (verification only).

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: PASS — type-check, lint, esbuild (extension), and Vite (webview) all complete without errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all webview, extension, and server tests stay green.

- [ ] **Step 3: Launch the Extension Dev Host (manual)**

In VS Code, press F5 to launch the Extension Development Host. Open the Pixel Agents side panel and the full-screen panel (icon in the side-panel title bar) so both webviews are live.

- [ ] **Step 4: Manual QA — terminal pane frame**

Spawn at least one agent, ensure `Use in-panel terminal` is enabled in Settings, click the agent to focus it. Verify:

- The xterm viewport sits inside a 2px `PANEL_BORDER` frame on left, right, and bottom edges.
- The terminal text doesn't touch the frame (2px inner padding).
- The xterm scrollbar (visible once enough output exists — try running `seq 1 200` in the terminal) is 8px wide with sharp corners, `--color-border` thumb, `--color-accent` on hover.

- [ ] **Step 5: Manual QA — focused-agent identity strip**

With a focused agent:

- Bottom panel mode: identity strip on the left of the header, full header height, accent text, 2px `PANEL_ACCENT` underline at the bottom of the strip (right above the terminal frame).
- Left panel mode: identity strip at the top of the panel column, accent text, NO underline (other-agents column sits below it).
- Right panel mode: same as left mode — no underline.

Switch panel position via Settings to verify all three.

- [ ] **Step 6: Manual QA — rail focus-edge-drop**

Collapse the panel to the lite rail (close button on the header). With ≥2 agents:

- Bottom rail: the focused cell shows no top border (extends visually into the canvas above). Unfocused cells keep all four borders.
- Left rail: focused cell drops its right border (extends toward the canvas to its right).
- Right rail: focused cell drops its left border.

- [ ] **Step 7: Manual QA — hover affordances**

Hover over:

- Rail cells: background fades over 80ms to `--color-btn-hover`.
- Tab cells (when bottom panel is open): same fade.
- The `[hide]` button (header + rail): color fades from `PANEL_MUTED` to `--color-text`.
- The splitter handle: the 12×2 grip fades in over 120ms; fades out when leaving.

- [ ] **Step 8: Manual QA — overflow scrollbar in the rail**

Spawn enough agents to overflow the rail (10+ on a typical viewport). Scroll the rail. Verify the scroll thumb matches the xterm scrollbar (8px, sharp corners, `--color-border` → `--color-accent` on hover).

- [ ] **Step 9: Manual QA — both webviews in sync**

With side panel + full-screen panel both open: focus an agent in one, hover the rail in the other. Both surfaces should pick up the chrome changes consistently (CSS is global, but verify nothing got webview-specific).

- [ ] **Step 10: Commit if any manual-QA-driven tweaks were needed**

If any of the above QA steps revealed a needed adjustment (a missed className, a stray color), make the fix, run `npm run lint && npm run test:webview`, and commit with a focused message. Otherwise skip.

```bash
# Only if a tweak was needed:
git add <changed files>
git commit -m "$(cat <<'EOF'
visual-chrome: <focused description of the tweak>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

Mapping every spec section to a task:

| Spec item                                                | Implemented in                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| D1 — Terminal pane 2px border l/r/b                      | Task 3                                                             |
| D2 — Inner padding 4 → 2                                 | Task 3                                                             |
| D3 — Identity strip + bottom-mode accent underline       | Task 5                                                             |
| D4 — AgentCell focus-edge-drop + panelPosition prop      | Task 4                                                             |
| D5 — `.panel-cell-hover` / `.panel-icon-hover`           | Task 1 (CSS); applied in Tasks 4, 5, 6                             |
| D6 — Splitter 12×2 grip on hover                         | Task 1 (CSS) + Task 2 (component)                                  |
| D7 — `.pixel-scrollbar` + `.xterm-viewport` shared rules | Task 1 (CSS); applied in Task 6 (LiteRail); xterm matched globally |
| D8 — No new color tokens                                 | All tasks (reuses existing PANEL\__ / --color-_ tokens)            |
| D9 — One new prop on AgentCell                           | Task 4                                                             |
| `index.css` CSS rules                                    | Task 1                                                             |
| `TerminalPane.tsx` changes                               | Task 3                                                             |
| `PanelHeader.tsx` identity strip + threading             | Task 5 (strip) + Task 4 (threading)                                |
| `AgentCell.tsx` rewrite                                  | Task 4                                                             |
| `LiteRail.tsx` wiring (scrollbar + hover + threading)    | Task 6 (scrollbar + hover) + Task 4 (threading)                    |
| `Splitter.tsx` grip                                      | Task 2                                                             |
| Manual QA across both panel positions + both webviews    | Task 7                                                             |

No spec gaps.

## Notes for the implementer

- **`!important` is intentional** in `.panel-cell-hover` and `.panel-icon-hover` (Task 1). It overrides the inline `background` / `color` styles in `AgentCell` and the hide buttons. Documented in the spec.
- **`PanelPosition` type** lives in `webview-ui/src/office/panel/panelTypes.ts` and is already imported by `PanelHeader.tsx`, `LiteRail.tsx`, `Splitter.tsx`. Task 4's `AgentCell` import statement adds it to that file's imports.
- **xterm viewport class** (`.xterm-viewport`) is xterm.js v5's internal DOM class. Stable across patch versions. The CSS rule in Task 1 matches it via a top-level selector — no class wiring inside `TerminalPane`.
- **Pre-commit hook** (lefthook + prettier + eslint) runs automatically on every commit. If prettier reformats a file, re-stage and the commit proceeds.
- **No new tests.** Visual chrome is presentational. `panel-layout.test.ts` stays green throughout (no dimensions or state altered).
