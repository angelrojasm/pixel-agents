# Phase 2 — Final QA Checklist

> **Date prepared**: 2026-05-13
> **Branch**: `2026-05-12-terminal-polish` (76 commits past `main`)
> **Bundles covered**: Visual Chrome → Terminal QoL → Terminal ↔ Character Interaction → Settings Redesign
> **Automated state**: 275 tests passing (87 webview / 148 server / 40 extension). Full build clean. Lint clean.

## How to run this

1. F5 in VS Code on this branch → Extension Development Host launches.
2. In the host window, open the **Pixel Agents** side-panel (Activity Bar).
3. Work top-to-bottom. Each section says what you'll see and what's wrong if it fails.
4. Tick boxes as you go. The "Out of scope" list at the bottom says what was deferred.

A failure in any item ⇒ ping the orchestrator (me) with the file:line where it's wrong; I have full traceability on every commit.

---

## 1. Visual Chrome (shipped 2026-05-13)

### 1.1 Terminal pane pixel border

- [ ] Open an agent (+ Agent button), enable **Use in-panel terminal** in Settings, focus the agent.
- [ ] Terminal pane has a **2 px solid pixel-border on left, right, and bottom** (top is the splitter/header).
- [ ] Inner padding around xterm is tight (2 px, not 4 px).

### 1.2 Identity strip in the panel header

- [ ] The focused-agent header tab is filled with **`PANEL_BG_CELL` background**, accent text color.
- [ ] In **bottom panel mode**, the identity strip has a **2 px `PANEL_ACCENT` underline** flush with the header/terminal boundary.
- [ ] In **side panel mode** (right or left), there is no underline (it's a vertical layout).

### 1.3 Tab focus drop-edge on rail cells

- [ ] Hide the panel chrome down to the rail. The focused agent's rail cell has its border **dropped on the edge that faces the canvas** (top edge for bottom rail; right or left edge for side rails).
- [ ] Non-focused cells have all four borders.

### 1.4 Hover affordances

- [ ] Hovering any agent cell triggers an 80 ms background fade (`panel-cell-hover`).
- [ ] Hovering the panel `[hide]` button and the rail `[hide]` button triggers an 80 ms color fade (`panel-icon-hover`).

### 1.5 Pixel scrollbar

- [ ] Scroll the rail when it overflows (many agents). The scrollbar is **8 px wide, sharp-cornered**, no rounded thumb.
- [ ] Scroll xterm scrollback. Same scrollbar style.
- [ ] Scroll the tab strip (open more agents than fit). Same scrollbar style.

### 1.6 Splitter grip indicator

- [ ] Hover the splitter (the seam between the canvas and the terminal pane). After 120 ms, a **12 × 2 px centered grip bar** fades in.

---

## 2. Terminal QoL (shipped 2026-05-13)

### 2.1 Search bar

- [ ] Focus the terminal. Press **Alt+F**.
- [ ] A search bar overlays the top-right of the terminal: `PANEL_BG_CELL` bg, 1 px `PANEL_BORDER`, sharp corners.
- [ ] Generate output: `seq 1 200 | awk '{print "line "$1" sample text"}'`
- [ ] Type `line 42`. Match count shows `1/1`. The match is highlighted in xterm.
- [ ] Type `sample`. Match count shows `1/200`.
- [ ] **Enter** = next match. **Shift+Enter** = previous match. Match count updates.
- [ ] **Esc** closes the bar. Focus returns to xterm (you can immediately type).
- [ ] Click the `×` button. Same effect as Esc.
- [ ] Clear the input (Backspace through all of it). Match count goes blank.

### 2.2 Clickable links

- [ ] In the terminal: `echo "https://docs.anthropic.com/en/docs/claude-code"`.
- [ ] Hover the URL: it gets a default xterm underline.
- [ ] Click it: opens in your default browser (via `vscode.env.openExternal`).
- [ ] Focus stays in the terminal after the click (no focus steal).

### 2.3 Copy / paste (deferred from per-bundle QA; verify here)

- [ ] Select a range of terminal output with mouse drag. **Cmd+C / Ctrl+C** copies. Paste into another app to confirm.
- [ ] With no selection: **Cmd+C / Ctrl+C** sends SIGINT (you'll see `^C` in bash, or the current Claude turn gets interrupted).
- [ ] Copy text from another app. **Cmd+V / Ctrl+V** pastes into the terminal prompt.
- [ ] **If clipboard write is blocked** by webview CSP → file the symptom; the bundle has a documented fallback (`@xterm/addon-clipboard`).

### 2.4 Search + Esc passthrough

- [ ] With **search closed**: press Esc in the terminal. Nothing visible happens (passthrough is correct — bash Esc has no visible effect).
- [ ] With **search open**: Esc closes search (does not pass through).

### 2.5 Alt+F re-press

- [ ] With search open, press Alt+F again. The search stays open (idempotent), input keeps focus.

---

## 3. Terminal ↔ Character Interaction (shipped 2026-05-13)

### 3.1 Focus halo on chair tile

- [ ] Spawn 2 agents. Click one on the canvas.
- [ ] Around the **clicked character's chair (work-seat) tile**, a **2 px solid accent halo** appears (sharp corners, 2 px outside the chair footprint).
- [ ] Click the other agent. The halo moves to that one's chair.
- [ ] **Important**: the halo stays on the chair even when the character is wandering around the office (it does NOT follow the character's current tile).
- [ ] Click empty office space (deselect). The halo disappears.

### 3.2 Halo color variants

- [ ] **Idle-focused** (no active turn): halo is **dotted accent** (1 px on / 1 px off).
- [ ] **Active-focused** (mid-turn): halo is **solid accent**.
- [ ] **Active, not focused** (another agent is running while you focused this one): halo is **solid muted color** on the active-not-focused agent.
- [ ] **Awaiting-user** state: halo turns **amber** to match the bubble.

### 3.3 PTY → animation timing

- [ ] Enable **Use in-panel terminal** in Settings. Spawn a new agent.
- [ ] In its terminal: `for i in $(seq 1 200); do echo $i; sleep 0.05; done`
- [ ] While bytes are flowing, the character runs the **typing animation at full frame rate**.
- [ ] Stop the loop (Ctrl+C in the agent's terminal). **Within ~1 second**, the animation should switch to the **reading pose**.
- [ ] The character's `isActive` state is still true at this point — only the typing-vs-reading pose changes. The "Working…" overlay stays.

### 3.4 Crashed-agent glyph + acknowledgement

- [ ] In a pty-backed agent, kill the agent process: in the terminal, `kill -9 $$` (or Ctrl+\\ to send SIGQUIT).
- [ ] The terminal pane shows the exit info.
- [ ] On the canvas, the character renders **desaturated** (60% cut), and a **red `!` glyph** appears top-right of the chair tile.
- [ ] Click the character. The glyph disappears; the sprite re-saturates.
- [ ] **Reload the webview** (close + reopen the panel or DevTools → Cmd+R). If the agent is still in the exited state, the glyph **re-appears** (ephemeral acknowledgement, by design).

### 3.5 Restart button

- [ ] On the exited pane, look for a **`↻ Restart` button** top-left of the terminal area.
- [ ] Click it. The pty relaunches; the button disappears; the character re-saturates (no spurious glyph re-fire — the `intentionallyStopped` set guards this).

### 3.6 Sub-agent parent line

- [ ] Have a pty-backed agent run a Task tool (e.g. Claude does any sub-agent spawn).
- [ ] When the parent is **focused**, the sub-agent character is connected to the parent's chair tile by a **1 px dashed muted line**.
- [ ] Click an agent other than the parent. The dashed line disappears.

### 3.7 Hook health surfacing

- [ ] Kill the hook server externally: find its PID via `cat ~/.pixel-agents/server.json` and `kill -9 <pid>`. Wait ~15 s (3 missed heartbeats × 5 s interval).
- [ ] A **sticky toast** appears at the bottom-center of the panel: red, with a reason and a `×`.
- [ ] On the `[hide]` button in the panel header, a **4 × 4 red dot** is drawn.
- [ ] Click `×` on the toast. Toast disappears. The red dot **persists** until health recovers.
- [ ] Trigger a heartbeat (any hook event will do — bring the server back, e.g. by opening a new terminal that triggers a hook). Within a few seconds, the dot disappears.

### 3.8 Canvas keyboard shortcuts

> Browser tab claims Cmd/Ctrl+1..9, Cmd/Ctrl+F, etc.; canvas chords moved to Alt-based for the combined Phase 2+3 release.

- [ ] Focus the canvas (click it, not a terminal). Press **Alt+1**. The first agent in rail order gets focused (halo + panel switches to its terminal).
- [ ] Press **Alt+2** through **Alt+9**. Same behavior for each rail-ordered agent.
- [ ] Press **Alt+'** (Alt+Apostrophe). The panel **collapses** (equivalent to clicking `[hide]`).
- [ ] Click into the terminal pane (xterm focus). Press Alt+1. It does **NOT** focus another agent — xterm consumes the keystroke. The shortcut is canvas-context-only.

### 3.9 Multi-webview sync (focus is per-webview)

- [ ] Open both the side-panel and the full-screen panel (Pixel Agents: Open Full Screen command, or the icon in the side-panel title bar).
- [ ] Click an agent in the side-panel — the halo appears there.
- [ ] Click a **different** agent in the full-screen panel — the halo appears on the second agent there.
- [ ] Both halos coexist (one per webview). This is intentional.
- [ ] Crash an agent. The glyph appears in **both** webviews. Click in one to ack; it clears in both via broadcast.

---

## 4. Settings Menu Redesign (shipped 2026-05-13)

### 4.1 Opening + structure

- [ ] Click the Settings button in the bottom toolbar.
- [ ] A **720 × 520 centered modal** opens. Sharp corners, 2 px border, hard offset shadow, FS Pixel Sans throughout.
- [ ] Left sidebar (160 px): **General / Agents / Terminal / Office / About**.
- [ ] First-time open lands on **General**.
- [ ] **Esc closes** the modal. Click outside also closes.

### 4.2 Sidebar keyboard navigation

- [ ] Open Settings. The **close button** is the initial focus target (you can press Enter to close).
- [ ] Tab into the sidebar. Press **↓** to move to Agents, then **↓** again to Terminal.
- [ ] Each ↓ press moves the selection AND switches the content pane.
- [ ] Active category shows a **2 px accent left-bar** + **bold label**.
- [ ] **Focus trap**: from inside the modal, press Tab until you wrap around. The focus cycles within the modal (does not escape).
- [ ] **Shift+Tab** from the close button goes to the last focusable element.

### 4.3 Live-apply on every control

For each category, toggle a control and observe immediate effect:

- [ ] **General — Sound notifications**: toggle off. The next agent-turn-end no longer chimes.
- [ ] **General — Always show labels**: toggle on. Every agent shows their activity label permanently (not just on hover).
- [ ] **General — Show terminal names**: toggle on. Character nameplates show the underlying VS Code terminal name.
- [ ] **General — Debug view**: toggle on. The DebugView overlay appears at top-left of the canvas.
- [ ] **Agents — Watch all sessions**: toggle on. Any external `.claude/projects/<hash>/<uuid>.jsonl` files from other VS Code windows get adopted.
- [ ] **Agents — Instant detection (hooks)**: toggle off then on. Verify the running setting via reload.
- [ ] **Agents — Default terminal folder**: type a path (use `~/` and verify expansion).
- [ ] **Terminal — Use in-panel terminal**: toggle. New agents pick up the new setting; existing agents keep their old terminal type.
- [ ] **Terminal — Panel position**: switch between Bottom / Right / Left. The panel re-anchors.
- [ ] **Terminal — Font family**: switch to a different font. xterm font changes.
- [ ] **Terminal — Font size**: press the **−** and **+** buttons. xterm font size scales.
- [ ] **Terminal — Line height**: press **−** and **+**. xterm row pitch changes.
- [ ] **Office — Asset directories**: click "Add Asset Directory". Add a folder. The list updates. Click "Remove" on a row. The row disappears.

### 4.4 Restore Defaults

- [ ] In **General**, toggle 2 things off. Click **Restore Defaults** (top-right of the content pane).
- [ ] All General toggles revert to their default state.
- [ ] A **5 s UndoToast** appears at the bottom of the content pane: "Defaults restored. [Undo]".
- [ ] Click **Undo**. The pre-restore values come back. The toast disappears.
- [ ] Repeat for **Agents**, **Terminal**, **Office** categories.
- [ ] **Note**: in Terminal, `Panel Position` and `Font Size` are explicitly **NOT** restored (they're webview-local in `panelPersistence`). Only `Use in-panel terminal`, `Font Family`, `Line Height` should change.

### 4.5 Restore Defaults timer doesn't reset

- [ ] Click Restore Defaults in General. The UndoToast appears.
- [ ] **Within the 5 s window**, interact with another control (e.g. toggle a Terminal panel switch in another category). The toast's countdown should keep going from its original start time and dismiss after the full 5 s. It should NOT reset on every modal re-render.

### 4.6 Restore Defaults clicked twice quickly

- [ ] Click Restore Defaults in General. Within 2 s, click Restore Defaults in Terminal.
- [ ] The previous toast dismisses; a fresh toast appears for Terminal.
- [ ] Clicking Undo affects only the Terminal restore (most-recent snapshot wins).

### 4.7 Multi-webview sync of settings

- [ ] Open both side-panel and full-screen panel. Open Settings in **both**.
- [ ] In the side-panel modal, toggle Sound off.
- [ ] The full-screen panel modal's Sound checkbox **updates within one event-loop tick** to match.
- [ ] Repeat for Debug View, Always show labels, etc.
- [ ] Click Restore Defaults in one modal. The other modal's checkboxes also update (via `settingsLoaded` broadcast). The UndoToast appears in the modal where the click happened (per-modal scope — by design).

### 4.8 A11y

- [ ] Inspect the modal in DevTools. The inner panel `<div>` has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="settings-title"`.
- [ ] Sidebar `<nav>` has `role="tablist"`. Each tab `<button>` has `role="tab"`, `aria-selected`, `id="settings-tab-<id>"`, `aria-controls="settings-panel-<id>"`.
- [ ] The `<main>` has `role="tabpanel"`, `id="settings-panel-<active>"`, `aria-labelledby="settings-tab-<active>"`.
- [ ] On category switch, **focus jumps to the first interactive control** in the new panel.

---

## 5. Foundations (Phase 2 §0 — shipped earlier)

Quick smoke test to confirm nothing regressed:

- [ ] **MessageSink broadcast** — agents created in the side-panel appear in the full-screen panel.
- [ ] **PtyManager** — `usePtyTerminal=true` agents render in xterm, not the VS Code terminal strip.
- [ ] **Scrollback ring buffer** — scroll up in xterm to confirm history is preserved across `terminalPaneReady` events (e.g. after closing + reopening the panel).
- [ ] **agentRenamed via `/rename`** — in Claude, run `/rename "Pixel Agents Dev"`. The panel tab and character nameplate update.
- [ ] **Layout persisted across windows** — change the floor pattern in another VS Code window. The change appears in this one within ~2 s.

---

## What was deferred (NOT in this QA pass)

- **Settings → defaultCwd validation**: helper text shows on invalid paths, but no `~` validation regex is tested manually.
- **Pty-stub warning halo state**: deferred in v1 per the spec (yellow-tinted halo when usePtyTerminal=on but pty hasn't fired its first byte yet).
- **`Cmd/Ctrl+1..9` in Phase 3 browser SPA**: explicitly out of scope; the browser will steal these.
- **Performance criteria**: pty→animation latency target is ≤16 ms; renderer cost target is ≤0.5 ms/frame for the new passes. These were verified against the existing perf-profile skill's benchmarks but not re-measured for this QA.

## Branch state

```
$ git log --oneline main..HEAD | wc -l
76
$ npm test
... 275 passed, 0 failed
$ npm run build
... clean
```

Files of note when something looks off:

| Bundle                | Primary touchpoints                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual Chrome         | `webview-ui/src/office/panel/PanelHeader.tsx`, `AgentCell.tsx`, `LiteRail.tsx`, `Splitter.tsx`, `index.css`                                                   |
| Terminal QoL          | `webview-ui/src/office/panel/TerminalPane.tsx`, `useTerminalSearch.ts`, `TerminalSearchBar.tsx`, `webLinkHandler.ts`                                          |
| Character Interaction | `webview-ui/src/office/engine/characterHalo.ts`, `renderer.ts`, `characters.ts`, `useCharacterPtyActivity.ts`, `server/src/healthMonitor.ts`, `PtyManager.ts` |
| Settings Redesign     | `webview-ui/src/components/settings/`, `src/settingsDefaults.ts`, `src/constants.ts` (DEFAULT_SETTINGS)                                                       |

---

When done, mark this file with a `Status: PASS` line at the top (or `FAIL: <list of failed items>`) and commit it. Then the branch is ready to merge to main.
