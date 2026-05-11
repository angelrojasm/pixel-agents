# Configurable Panel Position + Terminal Font Size — Design

**Date:** 2026-05-08
**Status:** Approved design.
**Parents:**

- [Phase 2 Drawer UX](./2026-04-21-phase-2-drawer-ux-design.md) — reopens decision #3
- [Remote-Office Vision](./2026-04-21-remote-office-vision.md) — Phase-3 alignment

## Purpose

Two user preferences shipped together because they touch the same surface (the panel + Settings modal):

1. **Panel position is user-configurable.** The "bottom drawer" of the Phase-2 design becomes a panel that can dock at the **bottom**, **left**, or **right** edge of the office view.
2. **Terminal font size is user-configurable.** A numeric setting that today scales the `TerminalPaneStub` content; once xterm.js integration (D2) lands, the same setting is forwarded to the xterm options.

Both settings live in the in-app **Settings modal** and persist per-webview via `vscode.setState`.

## Decisions

Locked decisions from the Phase-2 spec that **still hold**:

- Push, not overlay (canvas resizes).
- Collapsed on first run; per-webview persistence after.
- Lite-rail is hideable with a peek tab.
- Unified focus action (character / rail cell / tab → focus + open).
- Symmetric across side panel + full-screen, with independent display state.
- `+ Agent` auto-focuses the new agent and opens the panel (subject to viewport floor).

Reopened in this spec:

- **Decision #3 (lite-rail position)** — was "bottom-only, hideable." Now: **rail follows the panel's edge**.

New for this spec:

- **D7. Panel position is configurable: `bottom | left | right`.** Default `bottom`. Persisted in `DrawerPersistedState` as `panelPosition`.
- **D8. Lite-rail follows the panel's edge.** Bottom panel → bottom rail (row of cells). Left/right panel → vertical column rail on the same edge (square cells: sprite + status dot, name on hover via the existing `title` attribute).
- **D9. Terminal font size is configurable.** Numeric setting `terminalFontSize` in CSS px. Default `14`. Range `[10, 24]`. Persisted alongside the other panel state.
- **D10. Side panel uses a width slice; bottom panel uses a height slice.** Layout math abstracts on axis: `'horizontal'` (bottom = height-axis) vs `'vertical'` (left/right = width-axis). The viewport-floor check applies to the relevant dimension (height for bottom panel, width for side panel).

## Layout

Given viewport box `(W, H)`, panel position `P ∈ {bottom, left, right}`:

| P      | Panel band axis | Open size           | Rail size | Peek size | Floor check |
| ------ | --------------- | ------------------- | --------- | --------- | ----------- |
| bottom | height          | `min(H * 0.4, 320)` | 28        | 6         | `H ≥ 360`   |
| left   | width           | `min(W * 0.4, 360)` | 32        | 6         | `W ≥ 480`   |
| right  | width           | same as left        | 32        | 6         | same        |

Notes:

- Side rails are slightly wider than the bottom rail (32 vs 28) because cells stack as squares with the status dot, and the touch target needs a bit more room.
- Side panel max is 360 instead of 320 because horizontal terminal text reads more naturally with a wider min line.
- Side panel viewport floor is on width, not height — a tall narrow window can still afford a side panel as long as `W ≥ 480`.

`computePanelBand(state, viewport)` becomes axis-aware and returns `{ mode, bandSize, canvasW, canvasH }`. Existing callers consume `canvasHeight`; they migrate to `(canvasW, canvasH)` and read whichever is relevant.

## Component Tree

The drawer subtree gets renamed to `panel/` (file + import paths) since it's no longer drawer-specific. Component renames:

- `BottomDrawer.tsx` → `OfficePanel.tsx`
- `useDrawerState.ts` → `usePanelState.ts`
- `DrawerHeader.tsx` → `PanelHeader.tsx` (bottom mode) + new behavior in side mode (header is rotated 90° conceptually — see below)
- `RailPeek.tsx` stays as the name; it's a thin tab regardless of edge

Internal renames (`drawerOpen` → `panelOpen`, `bubbleType` unaffected, etc.) match the new direction.

In **side mode**, the `PanelHeader` (focused-agent frame + tab strip + actions) becomes a thin top strip of the panel column rather than a horizontal header — the focused-agent frame is the top cell, then tab strip cells, then the terminal. Same logical layout, different orientation.

## State & Persistence

`DrawerPersistedState` extended:

```ts
export interface DrawerPersistedState {
  drawerOpen: boolean; // renamed → panelOpen below
  railHidden: boolean;
  panelPosition: PanelPosition; // NEW: 'bottom' | 'left' | 'right' (default 'bottom')
  terminalFontSize: number; // NEW: integer CSS px (default 14, clamped 10..24)
}
```

For migration: `loadDrawerState` defaults missing fields. Existing webviews that have only `{drawerOpen, railHidden}` keep working — they get bottom panel + 14px font on next load.

`PanelPosition`:

```ts
export const PanelPosition = {
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
} as const;
export type PanelPosition = (typeof PanelPosition)[keyof typeof PanelPosition];
```

Internal field rename (no protocol/persistence break): `drawerOpen` becomes `panelOpen` everywhere except the persisted JSON key — keep the persisted key as `drawerOpen` for backwards-compat (or write a migration; defaulting handles new fields, but renaming the existing key would lose old preferences).

**Pragmatic call:** keep the persisted key as `drawerOpen`. Internally the state field is `panelOpen`. Translation lives in `panelPersistence.ts`. One-line ugliness, zero migration burden.

## Settings UI

Settings modal grows two controls:

1. **Panel Position** — radio group: Bottom / Left / Right. Wired to `usePanelState.setPanelPosition(value)`.
2. **Terminal Font Size** — number input with min 10 / max 24, plus + / – buttons. Wired to `usePanelState.setTerminalFontSize(n)`.

Both saved to `vscode.setState` immediately on change. Both apply to the current webview only; if the user has both side panel and full-screen open, they can configure them independently (consistent with decision #5).

## Behavior

**Layout flex direction.** The outer container in `App.tsx` switches between `flex-direction: column` (bottom panel) and `flex-direction: row` (side panel). Order of children flips for `right` (panel after canvas) vs `left` (panel before canvas).

**ResizeObserver.** `usePanelState` already observes the container. Now stores both `viewportWidth` and `viewportHeight`. The relevant dimension feeds into `computePanelBand` based on `panelPosition`.

**ToolOverlay coordinates.** Already keyed off `canvasAreaRef`'s rect — no math change needed; the canvas area still sits inside its own positioned div.

**Lite-rail in side mode.** `LiteRail` chooses `flex-direction: row` (bottom) or `column` (sides). Cells take a different variant: `'rail-bottom'` (72×20, sprite + name + dot) vs `'rail-side'` (24×24, sprite + dot, name on `title`). Hide-rail chip stays at the rail's far end (right edge in row mode, bottom edge in column mode).

**Panel header in side mode.** Header strip becomes top-of-column. Focused-agent frame on top (full width of panel, ~24px tall), tab strip below, then `[← hide]` (or `↑` arrow appropriate to the edge), and a thin separator above the terminal.

**`+ Agent` and viewport floor.** When `panelPosition` is `left`/`right`, the floor check is on width, not height — shrinking width below `MIN_PANEL_VIEWPORT_PX_HORIZONTAL` (480) force-collapses the panel to side-rail.

**Persistence cross-edges.** Switching from bottom to side does not auto-collapse: if `panelOpen` was true and the new edge passes its viewport floor, the panel stays open in the new orientation. The user explicitly chose the new edge.

## Out of Scope

- Drag-to-resize the panel. Default sizes only for v1; resize is a follow-up.
- Per-agent panel preferences. One panelPosition per webview, not per agent.
- Animated transitions when switching edges. Instant snap is fine.
- xterm.js integration itself (still D2). `terminalFontSize` flows to the stub for now (passed to `TerminalPaneStub` as a prop, applied via `style={{ fontSize }}`); xterm wiring happens later.
- "Off" position (rail hidden + panel hidden = nothing). The existing rail-hidden + collapsed-panel state is the closest to "off"; a fully-off mode isn't user-requested.
- Mobile / very narrow viewports beyond the 480px floor. Side-mode collapses; user sees rail only.

## Implementation Order

1. Constants (panel sizes for both axes, fontSize bounds, MIN floors).
2. Types + `PanelPosition` const map. Extend `DrawerPersistedState` with `panelPosition` + `terminalFontSize`.
3. **`computePanelBand` with TDD** — axis-aware. Tests cover all 9 combinations (3 positions × 3 modes) plus edge-mode floor cases.
4. State + persistence wiring: rename `drawerOpen` → `panelOpen` internally; persistence translates to/from the `drawerOpen` JSON key.
5. Hook (`usePanelState`) gains `setPanelPosition`, `setTerminalFontSize`, exposes both in returned API.
6. `AgentCell` gets a third variant `'rail-side'` (24×24, sprite + dot only, name on `title`).
7. `LiteRail` flex-direction by axis; `RailPeek` doesn't need changes (just sized to either axis).
8. `PanelHeader` (renamed from `DrawerHeader`) renders horizontal in bottom mode, vertical strip in side mode.
9. `OfficePanel` (renamed from `BottomDrawer`) chooses sizing axis; passes `terminalFontSize` to `TerminalPaneStub`.
10. `App.tsx`: outer flex direction follows `panelPosition`; child order flips for left vs right.
11. SettingsModal: panel position radio + font size number input.
12. Build + lint + tests.

## Testing

Pure modules:

- `computePanelBand` tests: 3 positions × {open, rail, peek} = 9 baseline cases + 3 floor-check cases (one per edge) + 1 edit-mode case = 13 tests minimum.
- `panelState` reducers: existing tests pass without change (focus, close, edit-mode, viewport). Add tests for `setPanelPosition`, `setTerminalFontSize` (clamping range).

No new server tests — server logic doesn't change.

E2E (manual): toggle each panel position from Settings, observe canvas reflows; toggle font size, observe stub text scales; open both webviews, set different positions, confirm independence.

## Compatibility With Phase 3

Same guarantees as Phase 2: all new code is `vscode`-free in `webview-ui/src/office/panel/`. The font-size and panel-position settings persist via `vscode.setState`, swappable for `localStorage` on the browser side. Settings modal keeps growing in-app, not in `contributes.configuration`.
