# Phase 2 UX — Bottom Drawer + Lite-Rail — Design

**Date:** 2026-04-21
**Status:** Approved design. Precedes Phase 2 implementation plan.
**Parent:** [`docs/ROADMAP.md`](../../ROADMAP.md) (formerly `2026-04-21-remote-office-vision.md`)

## Purpose

Phase 2 replaces VS Code's native terminal strip (for Phase-2-backed agents) with an **in-webview** terminal experience. Clicking a character or its rail cell opens a **bottom drawer** anchored below the office canvas, rendering that agent's terminal via xterm.js. When the drawer is collapsed, a **lite-rail** of agent cells preserves ambient "who's doing what" awareness.

This document fixes the webview-side UX and the extension↔webview protocol additions. It does **not** specify the `node-pty` pipeline or the `MessageSource` inbound abstraction in detail — those are tracked separately and consumed here as dependencies.

## Decisions

Six sub-questions locked during design review.

1. **Drawer geometry: push, not overlay.** When the drawer opens, the office canvas resizes to `H - drawerBand`. No alpha compositing over the canvas. The canvas remains integer-zoom pixel-perfect.
2. **First-run default: collapsed.** New users see the full office + lite-rail. Drawer open/closed state is persisted **per webview** via `vscode.setState`, so subsequent sessions restore whatever that specific webview was last at.
3. **Lite-rail position: bottom-only, hideable.** The rail lives along the bottom when the drawer is closed. A "hide rail" toggle collapses it to a 6px peek tab at the viewport bottom, which clicks to restore. No dock-to-side in v1.
4. **Expand trigger: unified focus action.** Clicking a character in the office OR a rail cell OR a tab in the open-drawer header → sets focused agent, opens the drawer. Clicking the currently-focused surface again collapses the drawer. Selecting + focusing + camera-follow stay in sync.
5. **Side panel and full-screen: symmetric, independent state.** Each webview stores its own `drawerOpen`, `railHidden`, `focusedAgentId`. Pty output is shared (one pty per agent, fan-out to all webviews). This lets a narrow side panel stay collapsed while the full-screen tab drives, without either disrupting the other.
6. **`+ Agent` behavior: auto-focus + auto-open.** Clicking `+ Agent` spawns the agent, makes it the focused tab, and opens the drawer — unless the viewport height is below `MIN_DRAWER_VIEWPORT`, in which case the character and rail cell appear but the drawer stays collapsed.

## Non-Goals (Out of Scope)

Tracked here so readers don't re-hunt the parent spec:

- **`node-pty` spawn pipeline** — lives in the Phase 2 backend track. This spec assumes pty-backed agents exist and emit output via a new protocol message.
- **`MessageSource` inbound abstraction** — separate prerequisite refactor. Mentioned where consumed but not specified.
- **Copy/paste integration with xterm.js** — parent spec carries this as open.
- **Preselected agents / bookmarks, multi-office layout** — queued feature ideas, orthogonal to this work.
- **`canPlaceOnWalls` furniture extensions, asset-manager changes** — unrelated.

## Layout

Given viewport height `H`, the office canvas and drawer share the vertical axis:

```
┌──────────────────────────────┐
│  OfficeCanvas                │  height = H - drawerBand
│                              │
├──────────────────────────────┤
│  drawerBand                  │
└──────────────────────────────┘
```

Where `drawerBand` is one of three sizes:

| Mode                  | Band height                                     | Notes                                                                     |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| open                  | `DRAWER_HEIGHT = min(Math.round(H * 0.4), 320)` | Pinned upper bound so enormous displays don't devote ~500px to a terminal |
| closed (rail visible) | `RAIL_HEIGHT = 28`                              | Fixed pixel height                                                        |
| closed (rail hidden)  | `PEEK_HEIGHT = 6`                               | Edge-hug tab                                                              |

**Viewport floor.** When `H < MIN_DRAWER_VIEWPORT` (≈ 360px), the drawer is force-collapsed to rail mode regardless of `drawerOpen`. Open requests are ignored until `H` recovers. When `H` grows back above the threshold, the drawer does **not** auto-open — `drawerOpen` is respected only when the viewport supports it.

The office canvas reads its height from a `ResizeObserver` on its container. Existing DPR and integer-zoom logic stays untouched; the canvas just receives a smaller CSS box.

## Component Tree

```
App.tsx
├── OfficeCanvas                    (existing; height-responsive via ResizeObserver)
├── ToolOverlay                     (existing)
├── BottomToolbar                   (existing: + Agent, Layout, Settings)
├── ZoomControls                    (existing)
├── SettingsModal / InfoModal       (existing)
└── BottomDrawer                    ← NEW shell; owns drawer state
    ├── DrawerHeader                (when open) — focused-agent frame on the left (sprite + name + status glyph), tab strip of OTHER agents to the right, [↓ hide] [✕] actions at the far right
    ├── TerminalPane × N            (one per live agent; visible iff focused)
    ├── LiteRail                    (when closed and not hidden) — cells per agent, [hide rail] chip
    └── RailPeek                    (when closed and railHidden) — 6px edge tab, click to restore
```

`LiteRail` cells and `DrawerHeader` tab-strip cells render from the same `agents` array using a shared `AgentCell` component with a size variant (`rail` ≈ 62×16, `tab` ≈ 40×14). The focused-agent frame in `DrawerHeader` is a larger, distinct component — it shows the same sprite + name + status glyph but with the selected styling (accent border, full opacity name) described in the sandbox mockup (`.superpowers/brainstorm/23247-1776808208/content/drawer-hybrid.html`).

**TerminalPane lifecycle.** Once created for an agent, TerminalPanes are **kept mounted** for that agent's lifetime. Focus switches visibility via `display: none`, not conditional render. Unmounting an xterm.js instance mid-session would discard scrollback, which we specifically want to keep for quick tab-switching. TerminalPane is unmounted only on `agentClosed`.

## State & Persistence

All drawer-owned state lives in `BottomDrawer`. No new extension-side storage is introduced for UI state.

| Field            | Type                    | Persistence                         | Notes                                                                         |
| ---------------- | ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `drawerOpen`     | `boolean`               | `vscode.setState`, key `drawerOpen` | Per-webview; each webview persists its own                                    |
| `railHidden`     | `boolean`               | `vscode.setState`, key `railHidden` | Per-webview                                                                   |
| `focusedAgentId` | `number \| null`        | not persisted                       | Defaults to most-recent agent on mount                                        |
| `terminalsReady` | `Map<agentId, boolean>` | not persisted                       | Set `true` once the TerminalPane has mounted and signaled `terminalPaneReady` |

**Why `vscode.getState`/`setState` and not extension `globalState`.** Webview state is already keyed per-webview by VS Code. Routing `drawerOpen` through extension globalState would force the side panel and full-screen tab to share it, which we rejected in decision #5.

**Extension-side additions to `AgentState` (`src/types.ts`):**

| Field        | Type                 | Notes                                                                                                                                        |
| ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptyBacked`  | `boolean`            | `true` → node-pty path, `false` → legacy `vscode.window.createTerminal`. Feature-flag for Phase 2 rollout; legacy path removable once stable |
| `scrollback` | `RingBuffer<string>` | Bounded buffer (≈ 2000 lines; exact size in constants file). Replayed to late-subscribing webviews via `ptyScrollback`                       |

Scrollback makes "open a second webview mid-session" work — without it, a newly-opened webview would render a blank terminal for an agent that's already been running.

## Message Protocol Additions

Existing messages (enumerated in `CLAUDE.md`) are unchanged. New messages below.

**Extension → webview (broadcast via `MessageSink`):**

| Message         | Payload                                              | Semantics                                                                                                            |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ptyData`       | `{ agentId: number, data: string }`                  | Raw pty output chunk; webview writes to its xterm.js instance if mounted, else ignores (buffer lives extension-side) |
| `ptyExit`       | `{ agentId: number, code: number, signal?: string }` | Pty process ended; webview displays exit marker, rail cell grays out                                                 |
| `ptyScrollback` | `{ agentId: number, lines: string[] }`               | Replay of buffered output; sent in response to `terminalPaneReady`                                                   |

**Webview → extension (via the new `MessageSource`):**

| Message             | Payload                                           | Semantics                                                       |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `ptyInput`          | `{ agentId: number, data: string }`               | Keystrokes or paste; extension writes to the pty's stdin        |
| `ptyResize`         | `{ agentId: number, cols: number, rows: number }` | Xterm.js fit-addon recalculated; extension calls `pty.resize()` |
| `terminalPaneReady` | `{ agentId: number }`                             | TerminalPane mounted; extension responds with `ptyScrollback`   |

**Dropped in v1:** a `drawerFocusChanged` webview→extension message. No current consumer. Trivial to add if a future feature (e.g., extension-side camera bias) needs it.

**Back-pressure / safety.**

- Single-chunk cap on `ptyData` (e.g. 1 MB). Pathological output gets split or truncated — protects the postMessage channel.
- Xterm.js has internal flow control for the rendered path; we rely on it.
- Keystroke volume is small; no back-pressure handling on the input path.

**Fan-out.** `MessageSink` already broadcasts outbound. `ptyData` reaches every webview; each one writes or ignores based on whether its TerminalPane for that agent is mounted. Late-mounting webviews catch up via `terminalPaneReady` → `ptyScrollback` round-trip.

## Flows

**Focus action (character click, rail click, tab click — one code path):**

```
focusOrToggle(X):
  if drawerOpen && focusedAgentId === X:
    setDrawerOpen(false)          // second click = collapse
    return
  setFocusedAgentId(X)
  setDrawerOpen(true)
  OfficeCanvas.selectedAgentId ← X    // pre-existing side-effect
  OfficeCanvas.cameraFollowId  ← X    // pre-existing side-effect
```

**`+ Agent` spawn:**

```
onAddAgent():
  extension: launchNewTerminal({ ptyBacked: true, … })
  webview: on agentCreated(newId):
    mount TerminalPane(newId)
    if viewportHeight ≥ MIN_DRAWER_VIEWPORT:
      setFocusedAgentId(newId); setDrawerOpen(true)
    else:
      // rail cell updates; drawer stays collapsed
```

**Hide / restore rail:**

```
onHideRail():          setRailHidden(true)
onRailPeekClick():     setRailHidden(false)
```

Hide-rail affordance is only visible when the drawer is closed. When the drawer is open the rail is replaced by the drawer header; nothing to hide.

**Agent close:**

```
onAgentClosed(X):
  unmount TerminalPane(X)
  if focusedAgentId === X:
    focusedAgentId ← most-recent-other-agent-id ?? null
    if focusedAgentId === null && drawerOpen:
      setDrawerOpen(false)        // nothing left to show
  remove rail cell
```

**Viewport shrink / grow:**

```
onResize():
  if newH < MIN_DRAWER_VIEWPORT:
    forceCollapsed ← true         // ignores drawerOpen
  else:
    forceCollapsed ← false        // respects drawerOpen, no auto-reopen
  every mounted TerminalPane: fit.refresh()
```

**Edit-mode coexistence:**

When Layout edit mode is entered, the drawer is **force-collapsed** (`drawerOpen` is not mutated; the visual is overridden). The existing `railHidden` value is respected — if the user had hidden the rail before entering edit mode, it stays a peek tab; otherwise the rail is visible while editing. Open/hide actions inside the drawer chrome are disabled during edit mode. Exiting edit mode drops the override and restores the persisted `drawerOpen`/`railHidden` values verbatim. Rationale: edit mode wants vertical real estate but the rail still carries useful "who's doing what" info; the user's prior hide choice is respected either way.

## Error Handling

| Situation                      | Behavior                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pty spawn fails                | Extension emits `ptyExit` with `code: -1` and a marker chunk: `[pixel-agents] terminal failed to start — reverting to VS Code native terminal`. Extension sets `ptyBacked = false` for that agent and reopens via `vscode.window.createTerminal`. Webview shows the marker and collapses the TerminalPane |
| Pty crashes mid-session        | Extension emits `ptyExit` with real code. Drawer shows `exited (code N) — click + Agent to restart`. Rail cell grays; character keeps its office animation based on existing JSONL/hook events                                                                                                            |
| Webview closes while pty alive | Pty keeps running (extension-owned). Reopening any webview replays scrollback via `terminalPaneReady` → `ptyScrollback`                                                                                                                                                                                   |
| Pty output chunk exceeds cap   | Split at cap boundary; log a warning once per agent to the extension console                                                                                                                                                                                                                              |

## Testing

**Webview unit (existing Vitest / Node test runner harness):**

- `BottomDrawer` state transitions: focus toggle, second-click collapse, viewport-shrink auto-collapse, edit-mode force-collapse.
- `LiteRail` and `DrawerHeader` render the agent list from a shared source — changing one agent's status updates both.
- `TerminalPane` visibility changes do not remount the xterm.js instance (inspect a sentinel ref between renders).
- Persistence round-trip with a mocked `vscode.getState/setState`.

**Integration (multi-webview):**

- Both side-panel and full-screen webviews open; drawer/rail state diverges and persists independently.
- `ptyData` broadcast reaches both; only the mounted TerminalPanes write it.
- Late-mounted webview issues `terminalPaneReady` and receives `ptyScrollback` for the matching agentId only.

**E2E (Playwright, extension dev host):**

- Click character → drawer opens → type `echo ok` → output appears.
- Click a different character → tab switches; previous terminal's scrollback remains intact on return.
- Click focused character again → drawer collapses.
- Hide rail → peek tab appears → click peek → rail restored.
- Enter edit mode → drawer force-collapses → exit → prior state restored.
- Side panel and full-screen open together; focus different agents in each; assert independence of drawer state while shared terminal output streams to both.

**Manual-only, noted:**

- Windows `ConPTY` via `node-pty` (mitigated in parent spec by Docker fallback).
- Copy/paste behavior (parent spec carries as open).
- Chatty-output perf: visual check under `grep -r` at repo root.

## Implementation Order

Captured here so the implementation plan lands in a sensible order. Not a work-breakdown.

### Dependencies (out of scope for this spec; tracked in separate plans)

- **D1. `MessageSource` prerequisite refactor.** The inbound abstraction described in the parent spec's principle #5. Must land before this spec's xterm.js integration step so the input path (`ptyInput`, `ptyResize`, `terminalPaneReady`) isn't bolted onto `Webview.onDidReceiveMessage` directly.
- **D2. Backend pty pipeline.** `node-pty` spawn path with `ptyBacked` flag; scrollback buffer; emit the five new messages. Legacy `createTerminal` path stays parallel, gated by `ptyBacked`.

### In scope for the plan this spec produces

1. **Drawer shell without terminals.** `BottomDrawer` + `LiteRail` + `DrawerHeader` + `RailPeek`; layout math; ResizeObserver on the canvas container; state + persistence. TerminalPane renders a placeholder (e.g. "terminal stub — agent N").
2. **xterm.js integration.** Replace the placeholder with a real `TerminalPane`; wire pty messages; fit-addon; scrollback replay on `terminalPaneReady`.
3. **Spawn + edit-mode behavior.** `+ Agent` auto-focus-and-open with viewport guard; edit-mode force-collapse; viewport-shrink safety.
4. **Legacy flag cleanup.** Once Phase 2 is stable on all platforms, remove the `createTerminal` fallback and the `ptyBacked` flag. Separate follow-up PR.

D1 and D2 must land before step 2 can compile; step 1 is independent and can proceed in parallel.

## Open Questions (Deferred)

Not blocking this spec; captured so nothing is lost.

- Scrollback buffer sizing policy — 2000 lines is a placeholder. Revisit once we have representative sessions to profile.
- Xterm.js addon selection (fit, web-links, serialize, search) — pick during step 4 of the implementation order.
- `drawerFocusChanged` outbound message — add if a future feature requires the extension to know which webview is viewing which agent.
- Copy/paste UX — owned by the parent spec.

## Compatibility With Phase 3

Everything added here is transport-agnostic:

- `BottomDrawer` and its children have no VS Code imports; they take `MessageSink`-shaped props.
- The new inbound messages (`ptyInput`, `ptyResize`, `terminalPaneReady`) go through `MessageSource`, which is the Phase-3-ready equivalent of `MessageSink` on the inbound side.
- `vscode.setState` usage in the webview is a webview-standard; on a browser transport the equivalent is `localStorage` with a per-connection namespace. Abstracting that is a small wrapper and not part of this spec.

This design does not introduce any new Phase-3 barriers.
