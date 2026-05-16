# Phase 3 — Remote App v1 (Local Daemon + Browser SPA)

**Date:** 2026-05-16
**Status:** Draft
**Branch:** `2026-05-12-terminal-polish` (continues, no new branch)
**Releases with:** Phase 2 (combined product release)

## Goal

Lift Pixel Agents out of the VS Code extension. End state: a standalone daemon (`pixel-agents`) on the user's laptop that serves the existing `webview-ui/` SPA over HTTP and exchanges messages over a WebSocket. The browser tab is the only UI.

## Scope of v1

| Aspect         | Decision                                                  |
| -------------- | --------------------------------------------------------- |
| Reach          | localhost-only (`127.0.0.1`)                              |
| UI             | Browser tab, served by the daemon                         |
| Distribution   | Personal tool. Run from the git checkout. No npm publish. |
| Auth           | Same-origin + token check on WebSocket upgrade            |
| VS Code role   | Deprecated; final cutover commit deletes extension code   |
| Phase 2 polish | Carries over unchanged (lives in `webview-ui/`)           |

**Non-goals (explicit):** multi-user, accounts, LAN exposure, cloud relay, installers, code-signing, public docs, telemetry, backward compatibility post-cutover.

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

The webview-side adapter swaps `acquireVsCodeApi()` for a small WebSocket client (`webview-ui/src/transport.ts`) with reconnect + offline-queue. Existing `useExtensionMessages.ts` consumes the same interface; no per-message refactor.

**Library choice:** `ws` (zero deps, ~4kLoC, used by `vite-plugin-ws` and `@xterm/addon-attach`). Not Socket.IO (overkill, ships its own protocol).

### Module migration

Most of `src/` is already vscode-API-light. Phase 1 + Phase 2 did this on purpose.

| Today (`src/`)               | Tomorrow                      | Change                                                  |
| ---------------------------- | ----------------------------- | ------------------------------------------------------- |
| `extension.ts`               | (gone)                        | Activation merges into `bin/serve.ts`.                  |
| `PixelAgentsViewProvider.ts` | (gone)                        | Replaced by daemon's WS broadcast + HTTP server wiring. |
| `agentManager.ts`            | `daemon/agentManager.ts`      | Remove `vscode.window.createTerminal` path. Pty-only.   |
| `configPersistence.ts`       | `daemon/configPersistence.ts` | No change.                                              |
| `layoutPersistence.ts`       | `daemon/layoutPersistence.ts` | No change.                                              |
| `fileWatcher.ts`             | `daemon/fileWatcher.ts`       | No change.                                              |
| `transcriptParser.ts`        | `daemon/transcriptParser.ts`  | No change.                                              |
| `timerManager.ts`            | `daemon/timerManager.ts`      | No change.                                              |
| `assetLoader.ts`             | `daemon/assetLoader.ts`       | Drop the `vscode.Uri`-based path resolver fallback.     |
| `types.ts`                   | `daemon/types.ts`             | Drop `vscode.Terminal` from `AgentState`.               |
| `constants.ts`               | `daemon/constants.ts`         | Drop VS Code-only keys (commands, view IDs).            |
| `PtyManager.ts` (existing)   | `daemon/PtyManager.ts`        | No change (already vscode-free).                        |
| `server/src/server.ts`       | `daemon/server.ts`            | Add WebSocket + static serving (see below).             |

The split between `src/` (extension) and `server/` (server) collapses into a single `daemon/` tree.

### `webview-ui/` becomes the SPA

`webview-ui/` already builds with Vite to `webview-ui/dist/`. No vscode imports in the rendering code. Phase 3 work in this directory:

- `useExtensionMessages.ts`: rename internally to `useDaemonMessages.ts`; consume the new transport. Public hook signature unchanged.
- `acquireVsCodeApi()`: replaced by `transport.ts` (WS adapter).
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

New `daemon/agentsPersistence.ts` mirrors `configPersistence.ts`: atomic `tmp + rename`, no migration from `workspaceState` (one-way cutover, personal tool).

Settings keys that move out of `globalState` into `config.json`: `soundEnabled`, `watchAllSessions`, `hooksEnabled`, `alwaysShowLabels`, `showTerminalNames`, `defaultCwd`, terminal font family/size/line-height, panel position, debug view, plus anything else `settingsLoaded` carries today.

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

1. **Origin allowlist on the WebSocket upgrade.** Reject any `Origin` that isn't our own scheme+host+port.
2. **Token check on the WebSocket upgrade.** Token is the existing one from `server.json` (already used to authenticate hook POSTs). The SPA reads it from a `<meta>` tag embedded in `index.html` at request time, and includes it as `?token=...` on the WebSocket URL.
3. **Static-file routes don't require a token.** Same-origin + localhost-only binding is enough — and the SPA needs to load before it can talk WS.

Threat model: another process on the same machine, single user. Not adversarial. The above is sufficient.

## Migration phases

Each phase ends with both the extension and the daemon working. Step 7 is the irreversible cutover.

1. **Module decoupling.** Drop `vscode.*` imports from every module that doesn't need them. Convert `vscode.Disposable` returns to a plain `Disposable` interface (already what `MessageSource.onMessage` returns; widen). Extension still functions through thin shims.
2. **WebSocket transport.** Add `ws` to the daemon. Wire `WebSocketSink`, `WebSocketBroadcast`, `WebSocketSource`. Build the SPA-side transport adapter with reconnect + offline-queue. The VS Code webview keeps using `acquireVsCodeApi()`; the SPA tab uses the new transport.
3. **Static SPA serving.** Daemon serves `webview-ui/dist/` from `/`. Verify in a browser tab while the extension is also running.
4. **CLI entry point.** `bin/serve.ts` with `serve`, `install-hooks`, `uninstall-hooks`, `stop`, `status`. Open-browser-on-start.
5. **File-based persistence.** New `agentsPersistence.ts`. Settings keys leave `globalState`; the extension reads/writes through `config.json` for the new keys. No backfill from `workspaceState`/`globalState` — one-way switch.
6. **Pty-only.** Remove `vscode.window.createTerminal` path from `agentManager`. Delete the `usePtyTerminal` setting. The extension's webview still works; only behaviour change is that all new agents are pty-backed.
7. **Cutover commit.** Delete `src/extension.ts`, `src/PixelAgentsViewProvider.ts`, the activation events in `package.json`, and any remaining vscode-API imports. Repo's `package.json` becomes the daemon's. README rewrites to a personal CLI.

Each phase commits independently. CI keeps both paths green through step 6.

## Testing

- **Vitest server tests** carry over. New tests: WebSocket transport wire format, broadcast fan-out, Origin/token check on upgrade.
- **Webview tests** carry over. New: a fake WebSocket transport for `useExtensionMessages` (now `useDaemonMessages`).
- **Playwright E2E** is rewritten for a browser tab (Chromium pointed at `http://127.0.0.1:<port>`). Spins up the daemon as a subprocess, runs the existing flows.
- **Manual QA.** Phase 2 checklist sections 1–4 carry over with one swap: "Extension Dev Host" becomes "browser tab against `pixel-agents serve`". New sections cover daemon lifecycle, multi-tab sync, hook install/uninstall, settings persistence to `config.json`.

## Risks + sharp edges

- **node-pty native build on `npm install`.** Already true today. README documents.
- **Browser tab dies → daemon survives.** Tab reload must reattach to the same daemon state. WebSocket reconnect logic handles this; the daemon doesn't track per-tab session state.
- **Mid-refactor breakage.** Mitigated by the phased approach. Each phase ends with both transports working.
- **Settings migration loss.** Cutover is one-way; the user's existing globalState settings have to be reset in `config.json`. For a personal tool with the maintainer as the only user, this is a single manual step.
- **node-pty in daemon vs extension host.** The daemon is a regular Node.js process — same runtime as the extension host. node-pty already works there.
- **Browser opening on `serve`.** macOS `open`, Linux `xdg-open`, Windows `start`. The `open` npm package handles all three.
- **Browser hotkeys collide with canvas shortcuts.** `Cmd/Ctrl+1..9` are browser tab-switch shortcuts; `Cmd/Ctrl+'` is also reserved in some browsers. The Phase 2 QA checklist already flags these as "browser SPA out of scope." Document the loss; remap to non-conflicting shortcuts (e.g. `Alt+1..9`) as a follow-up.

## Future (not v1, but architecture preserves compatibility)

- **LAN exposure.** Bind to `0.0.0.0` + add pairing UX (printed pairing code, browser challenge). Origin/token machinery already in place.
- **Cloud relay.** Coordinator-in-the-cloud pattern from the roadmap; daemon's WebSocket transport swaps for a coordinator-originated WS.
- **Workspace picker.** SPA gains a folder selector that scopes the daemon's watcher and `defaultCwd`.

None of these affect the v1 design.
