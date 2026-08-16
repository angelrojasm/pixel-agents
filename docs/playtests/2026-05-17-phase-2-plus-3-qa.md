# Phase 2 + Phase 3 — Combined QA Checklist

> **Status: FAIL — 2026-08-14.** First functional QA of Path B (standalone daemon), run
> via Playwright against a fresh build of `2026-05-12-terminal-polish` (incl. the
> uncommitted hostBridge work). Two release-blocking bugs found. See results below.

## QA Session 1 — 2026-08-14 (Path B, automated via Playwright)

**Setup notes:** the user's main VS Code window was running the _installed_ pre-Phase-3
extension, which owned `server.json` (PID alive → daemon would attach to a server that
404s on `/`). Worked around by backing up `server.json` before `node dist/bin/serve.js
--no-open`; restored after. The B.1 "quit VS Code first" instruction is confirmed
load-bearing.

### Release blockers

1. **The daemon never consumes inbound WS messages** — `daemon/orchestrator.ts:407`
   registers `server.onWebSocketConnect((_src, perClientSink, _broadcast) => …)` and
   discards the `WebSocketSource`. `openClaude` is only handled in
   `src/PixelAgentsViewProvider.ts:301` (extension-only), and the daemon path never calls
   `ensurePtyManager`. Observed effects, each verified live: **+ Agent is a silent no-op**
   (B.6 FAIL), toggling Sound in Settings writes nothing to `config.json`, layout saves
   would be dropped, and terminal keystrokes would go nowhere. The browser tab is
   one-way glass: it can watch, it cannot act.
2. **`daemon/snapshotReplay.ts` field names have drifted from the webview handlers**
   (`webview-ui/src/hooks/useExtensionMessages.ts`). Verified over a live WS connect:

   | Message                  | replay sends           | webview expects                  | observed effect                                                                                                                          |
   | ------------------------ | ---------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
   | `characterSpritesLoaded` | `sprites`              | `characters`                     | TypeError on every connect                                                                                                               |
   | `floorTilesLoaded`       | `tiles`                | `sprites`                        | TypeError on every connect                                                                                                               |
   | `wallTilesLoaded`        | `tiles`                | `sets`                           | TypeError on every connect                                                                                                               |
   | `furnitureAssetsLoaded`  | `assets`               | `catalog` + `sprites`            | caught TypeError, logged                                                                                                                 |
   | `settingsLoaded`         | nested `settings: {…}` | flat fields                      | silent no-op → "Updated to v1.3!" toast reappears on **every** reload; sound/labels/etc. never reflect config                            |
   | `existingAgents`         | `[{id: 1}, …]` objects | `agents: number[]` + `agentMeta` | characters spawn titled **"Agent #[object Object]"**; live tool events (numeric ids) never bind → replayed characters never animate/work |
   | `layoutLoaded`           | `layout`               | `layout`                         | ✅ works — the office renders the real `~/.pixel-agents/layout.json`                                                                     |

   The office _looks_ fine only because `browserMock.ts` independently decodes the PNG
   assets client-side and dispatches correctly-shaped messages — it masks the broken
   replay. Root cause is process, not typo: there is no contract test tying
   `snapshotReplay.ts` shapes to the `useExtensionMessages.ts` parsers.

### What passed (Path B)

- **B.1 boot**: daemon starts, ephemeral port, `server.json` written with fresh token/PID. ✅
- **B.2**: SPA served at `/`, `<meta name="px-token">` present, WS connects with token. ✅
- **B.3**: layout replay works (see table); assets render (via BrowserMock, see blocker 2). ⚠️
- **B.4**: reload → WS reconnects, office re-renders identically. ✅
- **B.5**: second tab connects and renders the same state. Sync of _mutations_ untestable
  until blocker 1 is fixed. ⚠️
- **B.6-equivalent via Watch-All**: with `watchAllSessions` enabled directly in
  `config.json`, the external scanner adopted live Claude sessions; a `claude -p` probe
  session produced the **full character lifecycle in the browser**: matrix spawn →
  pathfind to work seat → seated + facing monitor which **switched to its ON sprite** →
  rail cell "Agent #5" with green active dot → despawn + rail removal on `SessionEnd`.
  Clicking the character opened the terminal panel band. ✅
- **B.7 hooks**: hook script installed at `~/.pixel-agents/hooks/claude-hook.js`, 14 hook
  entries in `~/.claude/settings.json`, and the full event pipeline verified live:
  `SessionStart`/adoption → `PreToolUse` → JSONL tool start/done → `Stop` → `SessionEnd`. ✅
- **B.8 CLI**: `status` (running/not-running, exit 0/1) ✅; `stop` (SIGTERM, clean exit,
  `server.json` removed) ✅; `install-hooks`/`uninstall-hooks` not exercised (hooks were
  already installed; didn't want to disturb the live install).
- **B.9 PID-prune**: `agents.json` correct after restart — externals persisted, ephemeral
  sessions pruned, `nextAgentId` advanced. ✅
- **B.10 hotkeys**: Alt+' collapses the panel ✅ (collapse-only, matches `[hide]`);
  Alt+1..9/Alt+F untestable without spawnable agents (blocker 1).
- Settings V2 modal (all 5 sections) and the layout editor (grid, 4 tool tabs) render
  correctly in the browser. ✅

### Polish findings (non-blocking)

- Browser tab title is "webview-ui" and favicon 404s (`vite.svg` not copied into
  `dist/webview/`). First impression for a shareable app.
- The no-pty terminal-panel placeholder says _"enable 'Use in-panel terminal' in
  Settings, then spawn a new agent"_ — that setting was **deleted** in T17 (pty-only),
  and "VS Code's native terminal strip" is meaningless in a browser tab. Stale copy in
  both runtimes for watch-only/external agents.

### Not yet run

- Path A (extension regression) and Path C (both runtimes at once) — blocked on wanting
  the blockers above fixed first, plus a VS Code Extension Dev Host session.

---

> **Date prepared:** 2026-05-17
> **Branch:** `2026-05-12-terminal-polish` (103 commits ahead of `main`)
> **Coverage:** Phase 2 polish (visual chrome → settings redesign) + Phase 3 (daemon + browser SPA + orchestrator extraction, keep-both)
> **Automated state:** 244 tests passing (server + extension). Build clean. The bulk of Phase 2's UI was QA'd in `2026-05-13-phase-2-qa-checklist.md` already — that doc is the **extension-path reference**; this doc layers Phase 3 work on top.

## How to use this

There are three paths to verify:

- **A. VS Code extension path** — does everything Phase 2 promised still work in the extension?
- **B. Standalone daemon + browser tab path** — does the new daemon serve a working office?
- **C. Both at once** — does multi-window safety + shared persistence still hold?

Walk top to bottom. Tick boxes. When something fails: paste the symptom + the file (or commit SHA) that looks suspicious back into the conversation; I'll drive the fix.

## 0. Setup (once per QA session)

- [ ] On branch `2026-05-12-terminal-polish`. `git status` clean.
- [ ] `npm install` — confirm `ws`, `open`, `@types/ws` are installed (`grep -E '"(ws|open|@types/ws)"' package.json`).
- [ ] `npm run build` — clean. Produces `dist/extension.js`, `dist/bin/serve.js`, `dist/hooks/claude-hook.js`, and `dist/webview/` (vite's `build.outDir` is `../dist/webview` — there is no `webview-ui/dist/`).
- [ ] `npm test` — all 270 pass.
- [ ] **Optional reset of user-level state** before QA (lets you observe the migration paths):
  - [ ] `mv ~/.pixel-agents ~/.pixel-agents.bak` (keep your real config safe).
  - [ ] After QA, restore: `rm -rf ~/.pixel-agents && mv ~/.pixel-agents.bak ~/.pixel-agents`.

---

## Path A — VS Code extension (the old path, still first-class)

### A.1 Baseline (run the existing Phase 2 checklist)

- [ ] Open `2026-05-12-terminal-polish` in VS Code. F5. Extension Dev Host opens.
- [ ] Walk through every section of [`2026-05-13-phase-2-qa-checklist.md`](2026-05-13-phase-2-qa-checklist.md) **substituting `Alt+N` for every `Cmd/Ctrl+N` mentioned**:
  - Visual chrome (§ 1.1–1.6)
  - Terminal QoL (§ 2.1–2.5) — note: `Cmd/Ctrl+F` was remapped to `Alt+F` for search bar
  - Terminal ↔ character interaction (§ 3.1–3.9) — note: `Cmd+1..9` was remapped to `Alt+1..9`; `Cmd+'` is now `Alt+'`
  - Settings redesign (§ 4.1–4.8)
  - Foundations smoke test (§ 5)

### A.2 New Phase 3 stuff that lives in the extension

- [ ] **Settings now persist to `~/.pixel-agents/config.json`** (not VS Code globalState). Toggle a setting (e.g., Sound Notifications off), then `cat ~/.pixel-agents/config.json` — you should see `"pixel-agents.soundEnabled": false`.
- [ ] **Agents persist to `~/.pixel-agents/agents.json`** (not workspaceState). Create 2 agents, reload window, agents come back. `cat ~/.pixel-agents/agents.json` shows the live state, including `palette`, `hueShift`, and `workSeatId` per agent.
- [ ] **Side-table migration (only if you have pre-T14 state in workspaceState).** First load with the new code should merge `pixel-agents.agents` + `pixel-agents.agentSeats` workspaceState keys into the new file. `cat ~/.pixel-agents/agents.json` after first activation — every agent should have `palette` / `hueShift` / `workSeatId` populated. Skip this if you blew away `~/.pixel-agents/` in setup.
- [ ] **`pixel-agents.exportSettings` command available** in Command Palette. Run it — should write `/tmp/pixel-agents-settings-dump.json` and toast the path. `cat` it, confirm full `pixel-agents.*` prefixed keys.
- [ ] **Pty-only confirmed.** Settings → Terminal: "Use in-panel terminal" toggle is **gone** (deleted). New agents always spawn in xterm pane, never in a VS Code Terminal strip.

---

## Path B — Standalone daemon + browser tab

### B.1 Daemon boot

- [ ] **Quit VS Code first.** `PixelAgentsServer.start()` reuses any server whose PID is
      alive (`server/src/server.ts`), so a running extension host makes the daemon attach
      to _that_ process instead of starting its own — you'd get a URL that 404s.
- [ ] In a fresh terminal (NOT inside VS Code's terminal): `node dist/bin/serve.js` (or `npm run serve`)
- [ ] Console output: `[Pixel Agents] daemon listening on http://127.0.0.1:<port>` (port is ephemeral, e.g. 39187).
- [ ] Default browser opens automatically to that URL. (If not: `node dist/bin/serve.js --no-open` then paste the URL manually.)
- [ ] `cat ~/.pixel-agents/server.json` shows the same port + a fresh token + the daemon's PID.

### B.2 SPA loads + WebSocket connects

- [ ] Browser tab shows the office canvas.
- [ ] DevTools → Network → WS: one connection to `ws://127.0.0.1:<port>/ws?token=...` in **OPEN** state.
- [ ] DevTools → Network → Doc (or filter "Other"): `GET /` returned 200, and the HTML has a `<meta name="px-token" content="...">` tag in `<head>`.
- [ ] Console: no errors (or only WS reconnect noise when the daemon restarts intentionally).

### B.3 Snapshot replay (cold start)

- [ ] If you had persisted agents (from Path A or earlier sessions), the office shows them in the browser tab.
- [ ] Layout (floor tiles, walls, furniture) matches `~/.pixel-agents/layout.json`.
- [ ] Settings toggles in the SPA reflect `config.json` state (sound, labels, etc.).
- [ ] Open the Settings modal — values mirror what you'd see in the extension's Settings modal.

### B.4 Reconnect / refresh

- [ ] Reload the browser tab (Cmd/Ctrl+R). WebSocket disconnects and reconnects within ~500 ms (DevTools → Network → WS shows a new connection).
- [ ] The office re-renders into the same state (snapshot replay fires on every WS open). No flicker beyond the brief reconnect window.

### B.5 Multi-tab sync

- [ ] Open a second tab at the same `http://127.0.0.1:<port>`.
- [ ] Both tabs show the same agents.
- [ ] Per-tab state (camera follow, focused agent, panel collapse) is independent.
- [ ] Shared state (layout edits, agent state) syncs: edit a tile in tab A, watch it appear in tab B within ~1s.

### B.6 Spawn an agent in daemon mode

- [ ] Click "+ Agent" in the SPA toolbar (or whatever the equivalent is in the daemon path — settings → agents, or your standard new-agent gesture).
- [ ] An xterm-style terminal pane appears in the browser tab. The character animates into the office.
- [ ] In the terminal, run a short Claude prompt. Character should switch between typing (Write/Edit/Bash) and reading (Read/Glob) animations as tool calls flow.
- [ ] Stop the Claude turn (Ctrl+C in the terminal). Character returns to idle within ~1s.

### B.7 Hook integration

- [ ] `cat ~/.pixel-agents/hooks/claude-hook.js | head -3` — first few lines include `version: 3` marker.
- [ ] `cat ~/.claude/settings.json` — the hook entries point at `~/.pixel-agents/hooks/claude-hook.js`. If they don't, run `node dist/bin/serve.js install-hooks` once.
- [ ] Spawn an agent. Hook events flow to the daemon (DevTools → Network → WS shows agent-state messages on every tool call).
- [ ] **Hook health failure path:** find the daemon PID (`cat ~/.pixel-agents/server.json | jq .pid`) and `kill -9` it. Within ~15s of opening a new agent that triggers hooks, the SPA shows a red dot on the `[hide]` button + a sticky toast at the bottom. Restart the daemon — within a few seconds, dot + toast clear.

### B.8 Daemon CLI subcommands

- [ ] `node dist/bin/serve.js status` — alive: prints `running on http://127.0.0.1:<port> (pid <pid>)` and exits 0. With no daemon running: prints `not running` and exits 1.
- [ ] `node dist/bin/serve.js stop` — sends SIGTERM to the daemon PID, the daemon exits cleanly, `~/.pixel-agents/server.json` is removed.
- [ ] `node dist/bin/serve.js install-hooks` — writes hook entries to `~/.claude/settings.json` (idempotent).
- [ ] `node dist/bin/serve.js uninstall-hooks` — removes them.
- [ ] `node dist/bin/serve.js serve --no-open` — daemon starts without launching the browser.

### B.9 PID-prune on daemon restart

- [ ] With the daemon running and 1+ pty-backed agents alive, send `SIGTERM` (`node dist/bin/serve.js stop`).
- [ ] Restart: `node dist/bin/serve.js`. The startup PID-prune should drop those pty-backed agents from `agents.json` (their owning ptys are dead). `cat ~/.pixel-agents/agents.json` — `agents` array no longer contains them.
- [ ] External agents (from Watch-All) stay.

### B.10 Hotkey remap in browser

- [ ] **Alt+1** focuses agent 1 in the rail. **Alt+9** focuses agent 9 if present.
- [ ] **Alt+F** opens the terminal search bar (when terminal has focus). **Cmd/Ctrl+F** still opens browser find-in-page — that's expected (browser claims the chord).
- [ ] **Alt+'** collapses the panel.
- [ ] **Alt+Z / Alt+Shift+Z** = layout editor undo / redo.

---

## Path C — Both runtimes at the same time

The original Phase 1 multi-window safety still has to hold: two processes pointing at the same `~/.pixel-agents/` state should share — not corrupt.

### C.1 Extension first, daemon second

- [ ] F5 in VS Code. Extension activates, owns `~/.pixel-agents/server.json` (verify: `cat` shows the extension host PID).
- [ ] In a separate terminal: `node dist/bin/serve.js`. Console output should say something like `Reusing existing server on port <port>` (the PID-reuse path in `PixelAgentsServer.start`).
- [ ] Open the browser tab from the daemon's port. The SPA loads. **Both the VS Code side panel AND the browser tab are now connected** — they share the same orchestrator.
- [ ] Toggle Sound Notifications in the SPA's settings modal. Within one event-loop tick, the VS Code panel's settings modal reflects the change.
- [ ] Drag a piece of furniture in the layout editor in one client. The other client sees it after the debounced save (~500ms).

### C.2 Daemon first, extension second

- [ ] Close the Extension Dev Host. Start `node dist/bin/serve.js` from a terminal.
- [ ] Then F5 in VS Code. The extension activates and discovers the daemon's `server.json` — it should reuse the running daemon (not start a competing one).
- [ ] Browser tab + side panel coexist as in C.1.

### C.3 Crash recovery

- [ ] With both running, force-kill the daemon (`kill -9 $(cat ~/.pixel-agents/server.json | jq .pid)`). The extension stays alive, but its hook stream stops.
- [ ] Within ~15s, the extension's hook health toast + red dot fires (same machinery as B.7).
- [ ] Restart the daemon. Health recovers.

---

## Final

- [ ] After all paths pass, append `Status: PASS — 2026-05-17` to the top of this file and commit.
- [ ] On the branch, `git log --oneline main..HEAD | wc -l` — should be ~103 commits + however many fixes landed during QA.
- [ ] Decide: merge `2026-05-12-terminal-polish` → `main` and cut a release, or sit on the branch a while longer to dogfood.

## Known limitations (NOT bugs)

- **Cmd/Ctrl+F in the browser tab** opens browser find-in-page, not the terminal search bar. Use **Alt+F** instead.
- **Cmd/Ctrl+W in the browser tab** closes the tab. No recovery; the daemon keeps running, and reopening the tab restores state via snapshot replay.
- **External agents (Watch-All) in daemon mode** still rely on the project-level JSONL scanner — they appear when the daemon's file watcher catches new sessions, same as the extension's heuristic mode. Hooks mode (when enabled in `~/.claude/settings.json`) provides instant detection.
- **No browser-tab Playwright E2E** yet. Existing E2E targets the Extension Dev Host; the daemon path is verified manually for now.
