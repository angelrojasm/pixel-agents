# Phase 3 — Remote App v1 (Local Daemon + Browser SPA)

**Date:** 2026-05-16 (revised mid-execution)
**Status:** Draft — updated to reflect the keep-both-paths decision
**Branch:** `2026-05-12-terminal-polish` (continues, no new branch)
**Releases with:** Phase 2 (combined product release)

## Goal

Add a standalone daemon (`pixel-agents serve`) that exposes the existing `webview-ui/` SPA as a browser tab. The daemon and the VS Code extension are **both valid runtimes** — the daemon does not replace the extension. A shared `daemon/orchestrator.ts` runs the host-agnostic init (asset loading, agent restore, file watcher, hook event handler, snapshot replay); each host wires its host-specific glue (webview view + window events for the extension; static SPA serve + WebSocket broadcast for the daemon).

## Scope of v1

| Aspect         | Decision                                                                       |
| -------------- | ------------------------------------------------------------------------------ |
| Reach          | localhost-only (`127.0.0.1`)                                                   |
| UI             | Browser tab served by the daemon OR VS Code side panel/full-screen — both work |
| Distribution   | Personal tool. Run from the git checkout. No npm publish.                      |
| Auth           | Same-origin + token check on WebSocket upgrade                                 |
| VS Code role   | First-class runtime; not deprecated. Cutover deferred indefinitely.            |
| Phase 2 polish | Carries over unchanged (lives in `webview-ui/`)                                |

**Non-goals (explicit):** multi-user, accounts, LAN exposure, cloud relay, installers, code-signing, public docs, telemetry, deletion of the extension.

## Architecture

### Process layout

```
┌──────────────┐           ┌──────────────────────────────┐
│ Browser tab  │ ◄── WS ─► │  Daemon (Node.js)            │
│ (built SPA)  │ ◄── HTTP ─│                              │
└──────────────┘           │  HTTP server (existing)      │
                           │  WebSocket server (NEW)       │
                           │  Static file server (NEW)     │
                           │  PtyManager (existing)        │
                           │  JSONL watcher (existing)     │
                           │  Hook receiver (existing)     │
                           │  Persistence (existing)       │
                           └──────────────────────────────┘
                                  │
                  ┌───────────────┼───────────────────┐
                  ▼               ▼                   ▼
            ~/.claude/      ~/.pixel-agents/    PTY processes
            projects/       layout.json         (claude --session-id …)
                            config.json
                            agents.json (NEW)
                            server.json
```

### MessageSink / MessageSource (already in place)

The Phase 1 transport abstraction does exactly what Phase 3 needs. Today's `BroadcastSink` fans posts to a `Set<vscode.Webview>`. Tomorrow's fans to a `Set<WebSocket>`. The downstream modules (`agentManager`, `fileWatcher`, `transcriptParser`, etc.) don't change.

```ts
class WebSocketSink implements MessageSink {
  constructor(private ws: WebSocket) {}
  postMessage(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
    return Promise.resolve(true);
  }
}

class WebSocketBroadcast implements MessageSink {
  constructor(private clients: Set<WebSocket>) {}
  postMessage(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(s);
    return Promise.resolve(true);
  }
}

class WebSocketSource implements MessageSource {
  constructor(private ws: WebSocket) {}
  onMessage(handler) {
    const fn = (data: Buffer) => handler(JSON.parse(String(data)));
    this.ws.on('message', fn);
    return { dispose: () => this.ws.off('message', fn) };
  }
}
```

The webview-side adapter lives in the existing `webview-ui/src/vscodeApi.ts` — its `isBrowserRuntime` branch becomes a real WebSocket transport (reconnect + offline-queue + inbound dispatch). The VS Code branch stays permanently (keep-both decision). Existing `useExtensionMessages.ts` consumes the same interface; no per-message refactor. See the dedicated `webview-ui/` section below for the both-directions details.

**Library choice:** `ws` (zero deps, ~4kLoC, used by `vite-plugin-ws` and `@xterm/addon-attach`). Not Socket.IO (overkill, ships its own protocol).

### Module migration

Most of `src/` is already vscode-API-light. Phase 1 + Phase 2 did this on purpose.

| Today                                              | Tomorrow                      | Change                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                                 | unchanged (still entry point) | Stays. Activation now also builds a `daemon/orchestrator.ts` via `createOrchestrator(...)`. `bin/serve.ts` is the parallel daemon entry — both call the same orchestrator. |
| `src/PixelAgentsViewProvider.ts`                   | trimmed (~620 lines lighter)  | Stays as the webview-view registration + window-events shell. Orchestration delegated to `daemon/orchestrator.ts`.                                                         |
| `src/agentManager.ts`                              | `daemon/agentManager.ts`      | Remove `vscode.window.createTerminal` path. Pty-only. Drop `workspaceState` param; take typed I/O.                                                                         |
| `src/configPersistence.ts`                         | `daemon/configPersistence.ts` | No change.                                                                                                                                                                 |
| `src/layoutPersistence.ts`                         | `daemon/layoutPersistence.ts` | Drop `workspaceState` legacy-migration branch; file-only path remains.                                                                                                     |
| `src/fileWatcher.ts`                               | `daemon/fileWatcher.ts`       | No change.                                                                                                                                                                 |
| `src/transcriptParser.ts`                          | `daemon/transcriptParser.ts`  | No change.                                                                                                                                                                 |
| `src/timerManager.ts`                              | `daemon/timerManager.ts`      | No change.                                                                                                                                                                 |
| `src/assetLoader.ts`                               | `daemon/assetLoader.ts`       | Drop the `vscode.Uri`-based path resolver fallback; resolve bundled assets via `import.meta.url` + `fileURLToPath`.                                                        |
| `src/settingsDefaults.ts`                          | `daemon/settingsDefaults.ts`  | Drop `GlobalStateLike` param; take a `ConfigStore` (file-backed) instead.                                                                                                  |
| `src/pty/ptyManager.ts`, `src/pty/ptyWorker.ts`    | `daemon/pty/`                 | No change (already vscode-free).                                                                                                                                           |
| `src/types.ts`                                     | `daemon/types.ts`             | Drop `vscode.Terminal` from `AgentState`.                                                                                                                                  |
| `src/constants.ts`                                 | `daemon/constants.ts`         | Drop VS Code-only keys (commands, view IDs).                                                                                                                               |
| `server/src/server.ts`                             | `daemon/server.ts`            | Add WebSocket + static serving (see below).                                                                                                                                |
| `server/src/hookEventHandler.ts`                   | `daemon/hookEventHandler.ts`  | No change.                                                                                                                                                                 |
| `server/src/healthMonitor.ts`                      | `daemon/healthMonitor.ts`     | No change.                                                                                                                                                                 |
| `server/src/teamProvider.ts`, `teamUtils.ts`       | `daemon/teams/`               | No change.                                                                                                                                                                 |
| `server/src/providers/file/claudeHookInstaller.ts` | `daemon/hooks/installer.ts`   | Now invoked by the CLI (`pixel-agents install-hooks`) and on each `serve` startup for the script file (idempotent).                                                        |

The split between `src/` (extension) and `server/` (server) collapses into a single `daemon/` tree.

### `webview-ui/` becomes the SPA

`webview-ui/` already builds with Vite to `webview-ui/dist/`. No vscode imports in the rendering code. The existing `webview-ui/src/vscodeApi.ts` already exposes an `isBrowserRuntime` guard that returns a no-op transport when not inside a VS Code webview. Phase 3 work in this directory:

- `vscodeApi.ts`: replace the no-op browser branch with a real WebSocket-backed transport. **Both directions:**
  - Outbound: `postMessage()` writes to a `WebSocket` (single connection, queued while disconnected, replayed on open).
  - Inbound: today the hook uses `window.addEventListener('message', …)` to receive from the VS Code host. The browser branch must wire `ws.onmessage` to dispatch the same `MessageEvent`-shaped envelope to the existing handler. The webview-side gains a `MessageSource` adapter that mirrors the extension-side abstraction (symmetric with the server-side change).
  - VS Code branch stays permanently — the extension is a first-class runtime alongside the daemon.
- `useExtensionMessages.ts`: rename to `useDaemonMessages.ts`; consume the new transport. Public hook signature unchanged.
- A handful of message names referencing "extension" become "daemon" — cosmetic, find/replace.
- The 77 commits of Phase 2 polish (visual chrome, terminal pane, character interaction, settings redesign) all live here and carry over unchanged.

### Workspace concept

The daemon has no workspace. v1 behavior:

- The daemon watches all of `~/.claude/projects/` (Watch-All Sessions is the only mode).
- Agents the daemon spawns via pty are surfaced by `sessionId`.
- External Claude sessions (started from a regular terminal, etc.) are picked up via the hook receiver or the project-level JSONL scanner — same as today.
- New pty terminals use `defaultCwd` from `config.json`. Default: `~`.
- No "open a folder" gesture in v1. A future workspace picker is plausible but out of scope.

### Persistence

| Concept  | Today                         | Tomorrow                      |
| -------- | ----------------------------- | ----------------------------- |
| Agents   | `workspaceState`              | `~/.pixel-agents/agents.json` |
| Layout   | `~/.pixel-agents/layout.json` | unchanged                     |
| Config   | `~/.pixel-agents/config.json` | unchanged                     |
| Settings | `globalState` (multiple keys) | `config.json` (extended)      |
| Server   | `~/.pixel-agents/server.json` | unchanged                     |

New `daemon/agentsPersistence.ts` mirrors `configPersistence.ts`: atomic `tmp + rename`. The daemon is the sole reader/writer of `agents.json`, so no cross-process watcher is needed (unlike `layout.json` and `config.json`, which had to sync between two VS Code windows).

**`agents.json` schema (v1):**

```ts
interface AgentsFile {
  version: 1;
  nextAgentId: number;
  nextTerminalIndex: number;
  agents: PersistedAgent[];
}

interface PersistedAgent {
  id: number;
  sessionId?: string;
  terminalName: string;
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string; // survives — workspace folder name is dropped
  workSeatId?: string; // moved out of workspaceState
  palette: number; // 0–5
  hueShift: number; // degrees (0 when palette is unique)
  customTitle?: string;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}
```

Two `PersistedAgent` fields are dropped relative to today: `folderName` (only meaningful for multi-root VS Code workspaces) and the implicit `workspaceState` partitioning (the daemon has one global agents list).

**Settings backfill at phase 5 (one-time, decided path):**

Settings keys that move out of `globalState` into `config.json`: `soundEnabled`, `watchAllSessions`, `hooksEnabled`, `alwaysShowLabels`, `showTerminalNames`, `defaultCwd`, terminal font family/size/line-height, panel position, debug view, plus anything else `settingsLoaded` carries today.

To keep the extension functional through phases 5–6 (safety net), the extension's `settingsDefaults.ts` is rewired in phase 5 to read/write from `config.json` instead of `globalState`. A one-shot migration helper (`bin/import-extension-settings.ts`, ~30 lines) reads existing `globalState` values once via a tiny VS Code command (`pixel-agents.exportSettings`) added in phase 5, dumps them to `config.json`, and is then never run again. The extension and daemon share the same `config.json` from phase 5 onwards. No silent dual-storage drift.

### Daemon lifecycle

```
$ pixel-agents serve
[Pixel Agents] daemon listening on http://127.0.0.1:39187
[Pixel Agents] opening browser tab
[Pixel Agents] hooks installed (ok). Ctrl+C to stop.
```

- Binds to `127.0.0.1`, ephemeral port. Writes `~/.pixel-agents/server.json` (existing logic).
- If another `pixel-agents serve` is already running (PID alive in `server.json`), refuse to start. Print the existing URL.
- On startup: open `http://127.0.0.1:<port>` in the default browser via the `open` npm package.
- On `SIGTERM`/`SIGINT`: close WS connections, kill active ptys, delete `server.json`, exit.

CLI subcommands:

| Command                        | Effect                                                  |
| ------------------------------ | ------------------------------------------------------- |
| `pixel-agents serve`           | Start the daemon. Open the browser.                     |
| `pixel-agents serve --no-open` | Start without opening the browser.                      |
| `pixel-agents install-hooks`   | Write Claude hook entries to `~/.claude/settings.json`. |
| `pixel-agents uninstall-hooks` | Reverse of install-hooks.                               |
| `pixel-agents stop`            | Read PID from `server.json`, send SIGTERM.              |
| `pixel-agents status`          | Print port + PID + uptime, or "not running."            |

### HTTP routes

| Route                  | Method  | Purpose                                     |
| ---------------------- | ------- | ------------------------------------------- |
| `/`                    | GET     | Serve `webview-ui/dist/index.html`          |
| `/assets/*`            | GET     | Serve Vite-built assets (cached)            |
| `/ws`                  | UPGRADE | WebSocket upgrade with Origin + token check |
| `/api/health`          | GET     | Existing health endpoint                    |
| `/api/hooks/:provider` | POST    | Existing hook receiver                      |

### Multi-tab sync

A `Set<WebSocket>` on the daemon, fed into `WebSocketBroadcast`, mirrors today's multi-webview behavior. Open N tabs → N entries in the set → all sync. Per-tab UI state (camera follow, focused agent, panel collapse) remains per-tab (lives in the SPA, not broadcast).

### Security on localhost

The browser will let any tab on `http://localhost:*` (or `http://127.0.0.1:*`) connect to our port. Defense:

1. **Origin allowlist on the WebSocket upgrade.** Allowed origins: `http://127.0.0.1:<port>` and `http://localhost:<port>` (both resolve to our loopback bind; either is what a user might type). Reject everything else.
2. **Token check on the WebSocket upgrade.** Token is the existing one from `server.json` (already used to authenticate hook POSTs). The SPA reads it from a `<meta>` tag embedded in `index.html` at request time, and includes it as `?token=...` on the WebSocket URL.
3. **Static-file routes don't require a token.** Same-origin + localhost-only binding is enough — and the SPA needs to load before it can talk WS.

Threat model: another process on the same machine, single user. Not adversarial. The above is sufficient.

## Migration phases

Phases 1–5 keep the extension fully functional as a safety net. **Phase 6 makes pty the only terminal backend** — both hosts route through `node-pty` after this point; there is no fallback to `vscode.window.createTerminal`. Phase 7 was originally framed as the cutover commit (delete extension code) — that's been superseded by a single "extract `daemon/orchestrator.ts`" task that lets both hosts share orchestration without deleting either. The extension stays a first-class runtime.

1. **Module decoupling.** Drop `vscode.*` imports from every module that doesn't need them. Convert `vscode.Disposable` returns to a plain `Disposable` interface (already what `MessageSource.onMessage` returns; widen). Extension still functions through thin shims.
2. **WebSocket transport.** Add `ws` to the daemon. Wire `WebSocketSink`, `WebSocketBroadcast`, `WebSocketSource`. Build the SPA-side transport adapter (`vscodeApi.ts` browser branch) with reconnect + offline-queue + symmetric inbound dispatch. The VS Code webview keeps using `acquireVsCodeApi()`; the SPA tab uses the new transport.
   - **On every WebSocket `open` event (including reconnects)**, the daemon resends the snapshot needed to rehydrate a stale client: `existingAgents`, `layoutLoaded`, `settingsLoaded`, `hookHealthChanged`, plus per-agent `agentRenamed` and `agentTeamInfo` replays (mirrors today's `sendCurrentAgentStatuses` on `webviewReady`, just fired on every connect).
3. **Static SPA serving.** Daemon serves `webview-ui/dist/` from `/`. Bundled assets (sprites, default layout JSON, walls.png, etc.) resolve via `path.dirname(fileURLToPath(import.meta.url))` rather than `vscode.Uri.joinPath`. Verify in a browser tab while the extension is also running.
4. **CLI entry point.** `bin/serve.ts` with `serve`, `install-hooks`, `uninstall-hooks`, `stop`, `status`. Open-browser-on-start via the `open` package. On `serve` startup, the daemon writes `~/.pixel-agents/hooks/claude-hook.js` from a bundled copy if missing or out of date (version constant embedded in the script); ownership of that file moves from the extension's activation step to the daemon's startup step.
5. **File-based persistence.** New `daemon/agentsPersistence.ts`. Run the one-time `bin/import-extension-settings.ts` helper (or the `pixel-agents.exportSettings` VS Code command) to copy `globalState` values into `config.json`. Extension's `settingsDefaults.ts` is rewired to read/write `config.json` from this point on. During phases 2–5, daemon and extension share the same `~/.pixel-agents/server.json` via the existing PID-reuse logic; multi-window safety isn't regressed.
6. **Pty-only.** Remove `vscode.window.createTerminal` path from `agentManager`. Delete the `usePtyTerminal` setting. The extension's webview still works; only behavior change is that all new agents are pty-backed. **Once this lands the legacy fallback is gone — there is no extension-side rollback after step 6.**
7. **PID-prune on daemon boot.** On startup, the daemon enumerates `agents.json` and drops entries whose `sessionId`'s pty PID is no longer alive (verified via `process.kill(pid, 0)`); surviving JSONL sessions get re-adopted as externals by the project-level scanner. (Originally tasked alongside "cutover" — see step 8 below for the cutover's status.)
8. **Extract `daemon/orchestrator.ts` (T20', supersedes the cutover).** Lift host-agnostic init (asset loading, agent restore, file watcher, hook event handler, pty manager, snapshot replay wiring) out of `PixelAgentsViewProvider` into a new `daemon/orchestrator.ts`. Both `extension.ts` and `bin/serve.ts` call `createOrchestrator(...)` with host-specific deps. The VS Code extension stays a first-class runtime; the daemon now serves a working SPA end-to-end. **The original "delete extension code" cutover is dropped indefinitely** — see the [project memory](../../README.md#phase-3-keep-both-runtimes) for the decision history.

Each phase commits independently. Both runtimes (extension + daemon) stay green from step 5 onward. After step 6, native VS Code terminals are no longer used; both hosts spawn pty-backed agents.

## Testing

- **Vitest server tests** carry over. New tests: WebSocket transport wire format, broadcast fan-out, Origin/token check on upgrade.
- **Webview tests** carry over. New: a fake WebSocket transport for `useExtensionMessages` (now `useDaemonMessages`).
- **Playwright E2E.** Existing Extension Dev Host tests stay (extension is still a runtime). A new browser-tab-based suite is **optional** — add it when the daemon path becomes a primary dogfood surface.
- **Manual QA.** Phase 2 checklist sections 1–4 stay as written for the extension path. Add a parallel section for the daemon path: launch `node dist/bin/serve.js`, open the browser, walk through the same flows (creates / persists / multi-tab sync / hook install / settings persistence to `config.json`).

## Risks + sharp edges

- **node-pty native build on `npm install`.** Already true today. README documents.
- **Browser tab dies → daemon survives.** Tab reload must reattach to the same daemon state. WebSocket reconnect logic handles this; the daemon doesn't track per-tab session state.
- **Mid-refactor breakage.** Mitigated by the phased approach. Each phase ends with both transports working.
- **Settings migration.** Handled by the one-shot helper in step 5 (`bin/import-extension-settings.ts`), which reads `globalState` once via a temporary `pixel-agents.exportSettings` VS Code command and writes to `config.json`. After step 5 the extension reads/writes `config.json` directly — no silent dual-storage drift.
- **node-pty in daemon vs extension host.** The daemon is a regular Node.js process — same runtime as the extension host. node-pty already works there.
- **Browser opening on `serve`.** macOS `open`, Linux `xdg-open`, Windows `start`. The `open` npm package handles all three.
- **Browser hotkeys collide with canvas shortcuts.** The browser claims many of the chords today's canvas listens to: `Cmd/Ctrl+1..9` (tab-switch), `Cmd/Ctrl+'` (history in some browsers), `Cmd/Ctrl+F` (find-in-page, browser wins over the terminal-search override that worked in the webview), `Cmd/Ctrl+W` (close tab — no recovery), `Cmd/Ctrl+R` (reload — forces a full WS reconnect, handled by the snapshot-on-open logic in step 2), `Cmd/Ctrl+Z` (browser may steal in text inputs). **Resolution: remap every canvas/terminal shortcut from `Cmd/Ctrl` to `Alt` (or `Option` on macOS) as part of step 6 of the migration.** `Alt+1..9` selects the Nth agent; `Alt+'` collapses the panel; `Alt+F` opens terminal search; `Alt+Z`/`Alt+Shift+Z` undo/redo in the layout editor. The Phase 2 QA checklist's "canvas shortcuts" section gets rewritten with the new chords for the combined Phase 2+3 release.
- **Inbound state lost during a WS reconnect.** Mid-flight broadcasts can drop while a tab's WS is `CLOSING/CLOSED`. The snapshot-on-open replay in step 2 covers the rehydration; without it, a 500 ms reconnect window would leave a tab silently stale.

## Future (not v1, but architecture preserves compatibility)

- **LAN exposure.** Bind to `0.0.0.0` + add a pairing UX (printed pairing code, browser challenge). The token plumbing exists; the pairing UI and rotation logic do not.
- **Cloud relay.** Coordinator-in-the-cloud pattern from the roadmap; daemon's WebSocket transport swaps for a coordinator-originated WS.
- **Workspace picker.** SPA gains a folder selector that scopes the daemon's watcher and `defaultCwd`.

None of these affect the v1 design.
