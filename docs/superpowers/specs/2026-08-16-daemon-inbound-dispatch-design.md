# Daemon Inbound Dispatch + Snapshot Replay Contract — Design

**Date:** 2026-08-16
**Status:** Draft for spec review
**Origin:** QA session 2026-08-14 (`docs/playtests/2026-05-17-phase-2-plus-3-qa.md`) found
two release blockers in the standalone daemon path. This design fixes both, plus the
browser layout import/export flow that the shared-org plan requires.

## Context

The daemon (`bin/serve.ts` → `daemon/orchestrator.ts`) serves the SPA and broadcasts
state over WebSocket, but:

1. **Blocker 1 — inbound messages are discarded.** `orchestrator.ts` registers
   `server.onWebSocketConnect((_src, perClientSink, _broadcast) => …)` and never uses
   `_src`. All UI actions (`openClaude`, `saveLayout`, settings changes, pty keystrokes)
   die silently. The only inbound dispatch lives in
   `PixelAgentsViewProvider.handleWebviewMessage` (extension-only).
2. **Blocker 2 — `daemon/snapshotReplay.ts` output shapes drifted from the webview
   parsers** (`webview-ui/src/hooks/useExtensionMessages.ts`) on 6 of 7 message types.
   Both replay call sites are affected: WS-connect replay (daemon) and
   `replaySnapshotToSink` on `webviewReady` (extension). The extension never noticed
   because its own init path sends correctly-shaped messages alongside.

**New requirement from scoping (2026-08-16):** the repo is moving to a shared
organization; users of other forks arrive with already-designed office layouts. Layout
**import and export must work in the browser runtime**, not just in VS Code.
`openSessionsFolder` explicitly does NOT need a browser equivalent.

## Goals

- Every Path-B QA flow that failed on blocker 1 passes: + Agent spawns a pty-backed
  agent in the browser, terminal keystrokes flow, settings persist to `config.json`,
  layout saves persist, multi-tab mutation sync works.
- Snapshot replay delivers parseable messages; a contract test prevents re-drift.
- One dispatch table shared by both hosts — no second copy that can drift.
- Layout export/import works in the browser (download / file-picker).

## Non-goals

- LAN/relay exposure, pairing, workspace picker (unchanged Phase 3 backlog).
- Browser UI for adding external asset directories (needs a folder picker; daemon
  no-ops the add; remove-by-path still works). Known limitation.
- `openSessionsFolder` in the browser (explicitly descoped by Angel).

## Part 1 — Shared UI message dispatch (blocker 1)

### New module: `daemon/uiDispatch.ts`

```ts
export interface HostActions {
  // Extension: agent.terminalRef.show(). Daemon: no-op (pty agents have no terminalRef;
  // browser-side focus is client-local).
  focusTerminal(agent: AgentState, lead?: AgentState): void;
  // Extension: save dialog + write. Daemon: no-op + log (browser exports client-side).
  exportLayout(): Promise<void>;
  // Extension: open dialog when no inline layout given. Daemon: no-op + log.
  importLayoutViaDialog(): Promise<void>;
  // Extension: vscode.env.openExternal. Daemon: no-op + log (browser opens client-side).
  openExternal(url: string): void;
  // Extension: reveal ~/.claude/projects. Daemon: no-op + log.
  openSessionsFolder(): void;
  // Extension: showOpenDialog for a folder. Daemon: returns null (no-op + log).
  pickExternalAssetDirectory(): Promise<string | null>;
  // Extension: first-boot init (restoreAgents, scanners, o.start(), migrations).
  // Daemon: replay snapshot to the requesting client (idempotent).
  onWebviewReady(ctx: DispatchContext): Promise<void>;
}

export interface DispatchContext {
  /** Per-client sink for reply-to-origin messages (diagnostics, snapshot replay). */
  replySink: MessageSink;
}

export function createUiDispatch(deps: {
  orchestrator: Orchestrator;
  agents: Map<number, AgentState>;
  broadcastSink: MessageSink;
  config: ConfigStore; // daemon/configStore.ts — same instance both hosts already hold
  persistAgents: () => void;
  hostActions: HostActions;
}): { handle(message: Record<string, unknown>, ctx: DispatchContext): Promise<void> };
```

`handle()` owns the full message switch currently in
`PixelAgentsViewProvider.handleWebviewMessage`, minus nothing — host-specific branches
route through `HostActions`. The provider's method shrinks to: build `DispatchContext`
from the origin webview, call `dispatch.handle()`. This is the same single-source-of-truth
move T20' made for init.

### Message routing table

| Message                                                                                                                                                                      | Dispatch behavior                                                                                        | Host-specific?                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `openClaude`                                                                                                                                                                 | `launchNewTerminal(...)` with orchestrator state + `o.ptyManager`; register new agents with hook handler | No (pty-only since T17; cwd falls back defaultCwd → homedir via hostBridge) |
| `focusAgent`                                                                                                                                                                 | resolve agent/lead → `hostActions.focusTerminal`                                                         | Yes (VS Code reveal; daemon no-op)                                          |
| `dismissAwaitingUser`, `closeAgent`, `saveAgentSeats`, `saveLayout`, `acknowledgeCrash`, `restartAgent`, `restoreCategoryDefaults`, `setHooksEnabled`, `setWatchAllSessions` | existing orchestrator methods (already host-agnostic)                                                    | No                                                                          |
| all `set*` settings messages                                                                                                                                                 | existing `o.handleSettingsMessage`                                                                       | No                                                                          |
| `requestDiagnostics`                                                                                                                                                         | build report, post to `ctx.replySink`                                                                    | No (workspace fields come from hostBridge)                                  |
| `webviewReady`                                                                                                                                                               | `hostActions.onWebviewReady(ctx)`                                                                        | Yes (extension first-boot vs daemon snapshot re-replay)                     |
| `exportLayout`                                                                                                                                                               | `hostActions.exportLayout()`                                                                             | Yes                                                                         |
| `importLayout` **with inline `layout` payload**                                                                                                                              | validate (`version === 1`, `tiles` array) → `writeLayoutToFile` → broadcast `layoutLoaded`               | No (new; used by browser)                                                   |
| `importLayout` without payload                                                                                                                                               | `hostActions.importLayoutViaDialog()`                                                                    | Yes (extension keeps dialog flow)                                           |
| `openExternal`                                                                                                                                                               | `hostActions.openExternal(url)`                                                                          | Yes                                                                         |
| `openSessionsFolder`                                                                                                                                                         | `hostActions.openSessionsFolder()`                                                                       | Yes (daemon no-op, per scoping)                                             |
| `addExternalAssetDirectory`                                                                                                                                                  | `hostActions.pickExternalAssetDirectory()` → orchestrator add + rebroadcast                              | Yes (daemon no-op)                                                          |
| `removeExternalAssetDirectory`                                                                                                                                               | orchestrator remove by `path`                                                                            | No                                                                          |
| `ptyInput`, `ptyResize`, `terminalPaneReady`                                                                                                                                 | NOT in this dispatch — handled by `PtyManager.attachSource` (existing)                                   | —                                                                           |

### Daemon wiring (in `orchestrator.ts` `onWebSocketConnect`)

```ts
server.onWebSocketConnect((src, perClientSink, _broadcast) => {
  self.ensurePtyManager(src);                       // pty protocol per connection
  const sub = src.onMessage((m) => void dispatch.handle(m, { replySink: perClientSink }));
  // subscription lifetime = socket lifetime; WebSocketSource drops handlers on close
  void replaySnapshot({ sink: perClientSink, ... }); // unchanged, shapes fixed in Part 2
});
```

`ensurePtyManager(src)` already supports multiple sources (`attachSource` per webview in
the extension); each WS client attaches the same way. If `WebSocketSource` does not
already drop its handlers when the socket closes, add that (verify during
implementation; the wsServer integration test should assert no dispatch after close).

### Extension wiring

`PixelAgentsViewProvider` constructs one `createUiDispatch` with VS Code `HostActions`
(bodies moved verbatim from the current branches). `handleWebviewMessage` delegates.
The big `webviewReady` first-boot block moves into the provider's
`hostActions.onWebviewReady` unchanged. No behavior change intended on the extension
path; the existing extension test suite plus a delegation unit test cover it.

## Part 2 — Snapshot replay contract (blocker 2)

### Shape fixes in `daemon/snapshotReplay.ts`

The orchestrator's caches already hold correctly-named inner data
(`charSprites.characters`, `floorTiles.sprites`, `wallTiles.sets`,
`{catalog, sprites}`), so this is output-field renaming only:

| Message                  | fixed payload                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `characterSpritesLoaded` | `{ characters }`                                                                                                                                                            |
| `floorTilesLoaded`       | `{ sprites }`                                                                                                                                                               |
| `wallTilesLoaded`        | `{ sets }`                                                                                                                                                                  |
| `furnitureAssetsLoaded`  | `{ catalog, sprites }` (spread the cached object)                                                                                                                           |
| `settingsLoaded`         | flat spread of `buildSettingsPayload()` (webview reads `msg.soundEnabled` etc.)                                                                                             |
| `existingAgents`         | `{ agents: number[], agentMeta }` — reuse the builder logic from `agentManager.sendExistingAgents` (extract `buildExistingAgentsPayload(agents)` and use it in both places) |
| `layoutLoaded`           | unchanged (already correct)                                                                                                                                                 |

`SnapshotDeps` getters change accordingly (e.g. `getExistingAgents` returns
`{ agents, agentMeta }`). Both call sites (WS connect, `replaySnapshotToSink`) pick the
fix up automatically.

### Contract test: `daemon/__tests__/snapshotReplay.contract.test.ts`

Run `replaySnapshot` against representative deps with a capturing sink; assert **exact
top-level keys per message type** against a `MESSAGE_CONTRACT` table. The table lives in
the test with a comment block pointing at the corresponding
`useExtensionMessages.ts` parse sites (file cannot be imported across the
webview-ui/extension project boundary — the comment is the cross-link; the QA doc
records why drift here is expensive). Also assert `existingAgents` ids are numbers,
`settingsLoaded` carries no nested `settings` key, and replay emits messages in the
documented order (assets → state → per-agent).

### BrowserMock gating

`main.tsx` currently always runs `initBrowserMock()` when `isBrowserRuntime`. With
replay fixed, daemon-served pages would build the office twice (mock assets, then WS
replay). Gate the mock on transport availability: skip `initBrowserMock` when the
`px-token` meta tag is present (daemon-served page ⇒ real WS will provide everything).
`vite dev` standalone (no meta tag) keeps the mock. `App.tsx`'s
`dispatchMockMessages()` call gets the same guard.

## Part 3 — Browser layout export/import

Client-side, in the Settings → Office actions (`SettingsModal` handlers), branch on
`isBrowserRuntime` (same pattern as `webLinkHandler.ts`):

- **Export**: serialize the current layout (webview already holds it from
  `layoutLoaded`) → `Blob` → anchor-download `pixel-agents-layout.json`. No server
  round-trip.
- **Import**: `<input type="file" accept=".json">` → `JSON.parse` → validate
  `version === 1` + `tiles` array → `postMessage({ type: 'importLayout', layout })`.
  The shared dispatch (Part 1) validates again server-side, writes
  `~/.pixel-agents/layout.json`, and broadcasts `layoutLoaded` to all clients —
  identical end state to the extension's dialog flow.

VS Code runtime keeps native dialogs (no inline payload ⇒
`hostActions.importLayoutViaDialog`).

## Part 4 — Rider fixes (from the same QA, small and share-critical)

- `webview-ui/index.html`: `<title>Pixel Agents</title>` + a real favicon shipped into
  `dist/webview/` (replaces the 404ing `vite.svg`).
- Terminal-pane placeholder for watch-only/external agents: replace the stale copy
  referencing the deleted "Use in-panel terminal" setting with runtime-appropriate text
  (e.g. "This agent runs outside Pixel Agents — its transcript is being watched, but
  there is no terminal to attach.").

## Testing

- **Unit**: `uiDispatch` table tests (each message → expected orchestrator/hostActions
  call, using stub deps); `importLayout` inline-payload validation (rejects bad
  version/tiles); contract test per Part 2.
- **Integration**: extend `daemon/__tests__/wsServer.integration.test.ts` — client
  sends `setSoundEnabled` over a real WS → `config.json` updated; sends `openClaude` →
  agent appears in a subsequent broadcast; no dispatch after socket close.
- **Extension regression**: existing suite must stay green (provider delegation is
  behavior-preserving).
- **Manual/Playwright re-run** of QA Path B after implementation: + Agent spawns,
  terminal echoes keystrokes, settings toggle writes `config.json`, layout edit syncs
  to a second tab, import/export round-trips in the browser.

## Risks

- The provider `webviewReady` block move is the riskiest edit (190 lines of first-boot
  init). Mitigation: move verbatim, no logic edits, rely on the extension test suite +
  a Path-A smoke test.
- Multiple WS clients each attach a pty source; duplicate `ptyInput` is impossible
  (each keystroke arrives on one socket) but duplicated `terminalPaneReady` scrollback
  requests are expected and already idempotent in `PtyManager` (verify in integration
  test).
