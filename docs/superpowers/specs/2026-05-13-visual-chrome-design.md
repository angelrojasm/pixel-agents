# Visual Chrome — Design

**Date:** 2026-05-13
**Status:** Approved design.
**Parents:**

- [Roadmap](../../ROADMAP.md) — Phase 2 §1, first item in the "Recommended sequence (decided 2026-05-13)"
- [Phase 2 Drawer UX](./2026-04-21-phase-2-drawer-ux-design.md) — establishes the panel surfaces (`PanelHeader`, `LiteRail`, `AgentCell`, `RailPeek`)
- [Configurable Panel Position](./2026-05-08-configurable-panel-position-design.md) — introduces `panelPosition: bottom | left | right`, which the tab-attach logic depends on
- [Terminal Experience Polish](./2026-05-12-terminal-experience-polish-design.md) — shipped the `Splitter`, the resizable band, and the terminal font controls this bundle styles around

## Purpose

The panel chrome is functionally complete after the 2026-05-12 polish bundle but visually flat. The terminal sits naked on the chrome background. The focused agent reads as a thin outlined pill rather than an identity strip. The splitter is invisible. Rail cells have no hover state and no tab affordance. Overflow scrollbars are browser-default.

This bundle brings the panel chrome up to the same pixel-art vocabulary already used elsewhere in the webview: 2px borders, sharp corners, hard offset shadows (`--shadow-pixel`), FS Pixel Sans, the `PANEL_*` color tokens. Visual only — no state, no persisted fields, no new messages.

Doing this first in the Phase-2 remainder sequence prevents rework on the upcoming bundles. Terminal QoL UI (search bar, link tooltips) will inherit these chrome tokens. The terminal ↔ character interaction layer will design bubbles and indicators against fully-styled chrome.

## Decisions

D1. **Terminal pane gets a 2px `PANEL_BORDER` frame on its left/right/bottom edges.** Top edge is already separated from the header by the header's own border; doubling it would only add noise.

D2. **Inner padding around xterm drops from 4px to 2px.** Matches the pixel-art density used everywhere else in the webview (every other 2px-bordered surface uses a 2px inner inset).

D3. **The focused-agent block in the header becomes an identity strip, not an outlined pill.** Left-aligned, fills the header's full thickness, name in `PANEL_ACCENT`. In bottom mode the strip gets a 2px `PANEL_ACCENT` `borderBottom` — the strip's bottom edge coincides with the header/terminal boundary, so the accent line literally connects the focused-agent identity to the terminal below. In side mode the strip omits the accent underline (its bottom edge sits against the other-agents column, not the terminal — an underline there would imply the strip owns the other agents). Background and accent text-color still distinguish the strip.

D4. **`AgentCell` becomes panel-position-aware** for focus edge-drop. When `isFocused`, the cell drops its border on the edge of the rail facing the office canvas — classic pixel-tab affordance, the focused cell "punches through" the rail strip. The rule applies in **LiteRail context only**:

- `rail` (bottom-mode rail at the bottom of the office): drop `borderTop` on focus → cell extends toward the canvas above.
- `rail-side` (side-mode rail on the panel's outer edge): drop the border facing the canvas — `borderRight` for left panel, `borderLeft` for right panel.
- `tab` variant: never focused (PanelHeader filters out the focused agent before rendering tabs) — no-op.
- `rail-side` in PanelHeader (side-mode header's other-agents column): also never focused (same filter) — no-op.

D5. **Hover affordances are CSS-only.** Two utility classes added in `index.css` (`.panel-cell-hover`, `.panel-icon-hover`). 80ms `background-color` transition. No transforms, no scale, no border-color animation — that would clash with the dense pixel density of the rail.

D6. **Splitter shows a 12×2 px centered grip on hover.** Opacity 0 → 1 over 120ms. Communicates "draggable" without permanent visual weight.

D7. **Pixel-art scrollbar is a `.pixel-scrollbar` utility class plus a direct `.xterm-viewport` selector.** Both targets share the same rules in `index.css` (Firefox `scrollbar-width: thin` + `scrollbar-color`; webkit `::-webkit-scrollbar*` — 8px, sharp corners, `--color-border` thumb, `--color-accent` on hover). The `.pixel-scrollbar` class is applied to the rail overflow div in `LiteRail` and the tab overflow div in `PanelHeader`. The xterm DOM viewport (xterm.js v5's stable `.xterm-viewport`) is matched directly by the CSS — TerminalPane needs no class wiring.

D8. **No new color tokens.** Reuse `PANEL_BG_CHROME`, `PANEL_BG_CELL`, `PANEL_BORDER`, `PANEL_ACCENT`, `PANEL_MUTED`, and the CSS `--color-*` variables.

D9. **One new component prop.** `AgentCell` gains `panelPosition: PanelPosition` so it can compute which edge to drop on focus. Threaded through `OfficePanel → PanelHeader / LiteRail → AgentCell`.

## Component Changes

### `TerminalPane.tsx`

Wrap the inner xterm container with a frame:

```tsx
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
```

xterm's scrollbar is styled by the global `.xterm-viewport` rule in `index.css` (see D7) — no class wiring needed here. Borders are the same in all three panel positions: "left/right/bottom" maps to "the three edges of the terminal pane that touch the outer panel band, not the header."

### `PanelHeader.tsx`

Replace the focused-agent pill with an identity strip. The accent underline applies in **bottom mode only**:

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
      <span aria-hidden style={{ width: 10, height: 12, background: PANEL_SPRITE_PLACEHOLDER }} />
      <span style={{ color: PANEL_ACCENT, fontSize: 10 }}>{focused.name}</span>
    </div>
  );
}
```

The strip uses `PANEL_BG_CELL` (slightly lighter than `PANEL_BG_CHROME`) so it visually pops against the chrome. The accent underline terminates at the strip's own width — not extending across the whole header.

The `[hide]` button gets `className="panel-icon-hover"`. Other-agent `AgentCell` calls pass `panelPosition` through.

### `AgentCell.tsx`

Add `panelPosition: PanelPosition` to props. Compute the edge to drop on focus — applies only to LiteRail-context variants (`rail`, `rail-side`); for `tab` (and `rail-side` used inside PanelHeader) the focused cell never renders, so the drop is a no-op:

```tsx
type DropEdge = 'top' | 'right' | 'bottom' | 'left' | null;

function focusDropEdge(
  variant: 'rail' | 'rail-side' | 'tab',
  panelPosition: PanelPosition,
): DropEdge {
  if (variant === 'rail') return 'top';
  if (variant === 'rail-side') return panelPosition === 'left' ? 'right' : 'left';
  return null; // 'tab' is never focused (PanelHeader filters focused out of its tab list)
}
```

When `isFocused && dropEdge !== null`, set the corresponding `border<Edge>` to `'none'`; remaining three edges stay `1px solid PANEL_ACCENT`. Apply `className="panel-cell-hover"` to all variants.

### `LiteRail.tsx`

- Add `className="pixel-scrollbar"` to the inner overflow `div`.
- Add `className="panel-icon-hover"` to the `[hide]` button.
- Pass `panelPosition` through to `AgentCell`.

### `OfficePanel.tsx`

- Pass `panelPosition` to `PanelHeader` (already does) and `LiteRail` (already does). No new prop wiring needed — both already receive it.
- No changes to layout or dimensions.

### `Splitter.tsx`

Add a hover-only grip indicator:

```tsx
const gripStyle: React.CSSProperties = horizontal
  ? { width: 12, height: 2, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  : { width: 2, height: 12, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

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

The grip's opacity is controlled by a CSS rule:

```css
.panel-splitter span {
  opacity: 0;
  transition: opacity 120ms ease-out;
}
.panel-splitter:hover span {
  opacity: 1;
}
```

### `index.css`

New utility classes in `@layer components`:

```css
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

.panel-splitter span {
  opacity: 0;
  transition: opacity 120ms ease-out;
}
.panel-splitter:hover span {
  opacity: 1;
}
```

`!important` on the hover background covers the inline `background: PANEL_BG_CELL` style on `AgentCell`. Without it, CSS specificity would lose to the inline style.

The xterm viewport scrollbar inherits from the `.pixel-scrollbar` class via descendant selector matching. xterm.js v5 renders `.xterm-viewport` inside the container — the class applied on the parent matches `::-webkit-scrollbar` on the descendant in webkit engines.

## Cross-cutting Concerns

**Both webviews.** Side panel and full-screen each render their own `OfficePanel`. CSS rules in `index.css` apply to both since they share the same stylesheet. No webview-specific paths.

**Both panel positions.** All chrome decisions are panel-position-aware: terminal-pane borders are always "left/right/bottom" (in panel-local terms); the accent strip underline lives on the edge facing the terminal; tab/cell drop-edge is computed via `focusDropEdge`.

**ARIA.** All currently-aria'd elements keep their attributes. The splitter retains `role="separator"` + `aria-orientation`. The grip is `aria-hidden`. The accent strip keeps the existing focused-agent `aria-label` on its parent button if any (today the focused-agent block is not a button; it's a presentational `<div>`, which stays).

**Z-index.** The splitter sits at `zIndex: 10` (existing). Its absolutely-positioned grip span uses no z-index — stays inside the splitter's stacking context.

## State & Persistence

None. Visual-only bundle.

## Testing

- **Manual QA in the Extension Dev Host.** Cover: bottom panel + left panel + right panel; each agent focus-switch; hover all rail cells, tab cells, `[hide]` buttons, splitter; drag the splitter; scroll past the rail overflow (spawn ≥10 agents); scroll past terminal scrollback. Verify both webviews open simultaneously (side panel + full-screen) remain in sync visually.
- **No new unit tests.** `panel-layout.test.ts` continues to pass (dimensions unchanged). No state, no reducers, no pure modules changed.
- **No E2E changes.** Playwright covers Phase-1 functionality; visual chrome is below the threshold for E2E coverage.

## Out of Scope

- xterm.js color theme beyond `background` (full ansi palette is terminal QoL).
- TerminalPaneStub re-skin (stub is going away when `usePtyTerminal` defaults to on; visual quality irrelevant for one more release).
- Settings modal pixel pass (own bundle — see `docs/superpowers/plans/2026-05-12-settings-redesign.md`).
- Layout / dimension / font-size changes (locked from prior bundles).
- New color tokens (reuse existing `PANEL_*` and `--color-*`).
- Animations beyond hover transitions (no entrance/exit motion, no parallax, no shimmer).
- `RailPeek` re-skin (its visual goal is already minimal-but-clear; revisit only if the rest of the chrome forces it out of style).
- xterm.js ANSI color tuning (terminal QoL).
- `OfficeCanvas` chrome (the canvas already has the pixel-art aesthetic).

## Implementation Order

1. CSS: add `.pixel-scrollbar`, `.panel-cell-hover`, `.panel-icon-hover`, `.panel-splitter span` rules to `index.css`.
2. `Splitter.tsx`: add `className="panel-splitter"` and the grip `<span>`.
3. `TerminalPane.tsx`: wrap the inner container with the 2px border + drop padding to 2px; add `className="pixel-scrollbar"` on the xterm container div.
4. `AgentCell.tsx`: add `panelPosition` prop, `focusDropEdge` helper, conditional border-drop on focus, `className="panel-cell-hover"`.
5. `PanelHeader.tsx`: replace focused-agent pill with identity strip + accent underline; thread `panelPosition` to `AgentCell`; add `className="panel-icon-hover"` to `[hide]`.
6. `LiteRail.tsx`: thread `panelPosition` to `AgentCell` (already received as prop); add `className="pixel-scrollbar"` to overflow div; add `className="panel-icon-hover"` to `[hide]`.
7. Lint + typecheck + unit tests.
8. Manual QA in Extension Dev Host across both panel positions + both webviews.

## Risks

- **Firefox scrollbar parity.** Firefox doesn't honor full `::-webkit-scrollbar` rules; falls back to `scrollbar-width: thin` + `scrollbar-color`. Accepted; goal is "doesn't clash," not pixel-perfect cross-engine parity.
- **xterm viewport class name.** `.xterm-viewport` is stable in xterm.js v5 but an internal detail. If a future version renames it, the scrollbar reverts to default — not a functional regression.
- **Tab-attach trick depends on flush layout.** If a future refactor inserts a gap between the header and the terminal, the focused-tab edge-drop stops attaching visually. Not a runtime bug; would require a follow-up if it happens.
- **`!important` on hover background.** Needed only because `AgentCell` uses an inline `background` style. If `AgentCell` is later refactored to use classes for its base background, the `!important` can be dropped. Acceptable for now — it's scoped to two utility classes and documented above.

## Compatibility With Phase 3

Same guarantees as prior bundles: all code stays `vscode`-free in `webview-ui/src/office/panel/`. New CSS lives in `webview-ui/src/index.css`. No new persistence, no new messages — the WebSocket transport replacement path is unaffected.
