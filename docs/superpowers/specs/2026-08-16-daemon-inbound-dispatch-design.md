# Daemon Inbound Dispatch + Snapshot Replay Contract — Design

**Date:** 2026-08-16 (revised same day after spec review; 14 findings folded in)
**Status:** Reviewed — ready for implementation planning
**Origin:** QA session 2026-08-14 (`docs/playtests/2026-05-17-phase-2-plus-3-qa.md`) found
two release blockers in the standalone daemon path. This design fixes both, plus the
browser layout import/export flow that the shared-org plan requires.

## Context

The daemon (`bin/serve.ts` → `daemon/orchestrator.ts`) serves the SPA and broadcasts
state over WebSocket, but:

1. **Blocker 1 — inbound messages are discarded.** `orchestrator.ts` registers
   `server.onWebSocketConnect((_src, perClientSink, _broadcast) => …)` and never uses
   `_src`. All UI actions (`openClaude`, `saveLayout`, settings changes) die silently.
   The only inbound dispatch lives in `PixelAgentsViewProvider.handleWebviewMessage`
   (extension-only), and the daemon never calls `ensurePtyManager`.
2. **Blocker 2 — `daemon/snapshotReplay.ts` output shapes drifted from the webview
   parsers** (`webview-ui/src/hooks/useExtensionMessages.ts`) on **7 of 8** replayed
   message types (the QA table listed 6 of 7; review found `hookHealthChanged` drifted
   too). Both replay call sites are affected: WS-connect replay (daemon) and
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
- Full Path C (extension-owned server + browser tab) QA — this design makes that path
  architecturally sound (see "WS wiring is host-owned"), but its QA pass stays pending.

## Part 1 — Shared UI message dispatch (blocker 1)

### New module: `daemon/uiDispatch.ts`

```ts
export interface HostActions {
  // Extension: agent.terminalRef.show(). Daemon: no-op (pty agents have no terminalRef;
  // browser-side focus is client-local).
  focusTerminal(agent: AgentState, lead?: AgentState): void;
  // Extension: agent.terminalRef.dispose() (VS Code-terminal agents still exist via
  // restoreAgents terminal matching). Daemon: never called (no terminalRefs exist).
  disposeTerminal(agent: AgentState): void;
  // Extension: save dialog + write. Daemon: no-op + log (browser exports client-side).
  exportLayout(): Promise<void>;
  // Extension: open dialog when no inline layout given. Daemon: no-op + log.
  importLayoutViaDialog(): Promise<void>;
  // Extension: vscode.env.openExternal. Daemon: no-op + log (browser opens client-side).
  // NOTE: the message field is `uri`, not `url`.
  openExternal(uri: string): void;
  // Extension: reveal ~/.claude/projects. Daemon: no-op + log.
  openSessionsFolder(): void;
  // Extension: showOpenDialog for a folder. Daemon: returns null (no-op + log).
  pickExternalAssetDirectory(): Promise<string | null>;
  // Extension: reads workspaceState 'pixel-agents.bypassPermissions' (restartAgent
  // needs it). Daemon: returns false.
  getBypassPermissions(): boolean;
  // Extension: first-boot init (restoreAgents, scanners, o.start(), migrations) —
  // moved verbatim from the provider's webviewReady branch, plus replaySnapshotToSink
  // for re-mounted webviews. Daemon: NO-OP (see "Replay trigger semantics").
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
  /** Extension passes context.extensionPath (setHooksEnabled → copyHookScript).
   *  Daemon passes undefined — its hook script is managed by ensureHookScript at boot. */
  hookScriptSourcePath?: string;
  hostActions: HostActions;
}): { handle(message: Record<string, unknown>, ctx: DispatchContext): Promise<void> };
```

`handle()` owns the full message switch currently in
`PixelAgentsViewProvider.handleWebviewMessage` — host-specific branches route through
`HostActions`. The provider's method shrinks to: build `DispatchContext` from the origin
webview, call `dispatch.handle()`. This is the same single-source-of-truth move T20'
made for init.

### WS wiring is host-owned (resolves the circular dependency)

`createUiDispatch` takes the orchestrator as a dep, so the orchestrator cannot register
the dispatch itself. **Move the `server.onWebSocketConnect` registration out of
`createOrchestrator` and into each host's wiring**, where both the orchestrator and the
dispatch already exist:

```ts
// bin/serve.ts (daemon) — and equivalently in extension.ts/provider for the
// extension-owned server (Path C browser tabs):
server.onWebSocketConnect((src, perClientSink, _broadcast) => {
  const ptySub = orchestrator.ensurePtyManager(src, perClientSink); // returns disposable
  const uiSub = src.onMessage((m) => void dispatch.handle(m, { replySink: perClientSink }));
  void orchestrator.replaySnapshotToSink(perClientSink);
  return () => {
    ptySub.dispose();
    uiSub.dispose();
  }; // see "WS close disposal"
});
```

Consequences:

- `orchestrator.ts` loses its `server.onWebSocketConnect` block; `replaySnapshotToSink`
  (already exposed) is the shared replay entry point.
- **Extension broadcast bridging:** the provider's `broadcastSink` fans out only to
  VS Code webviews today, so a browser tab on an extension-owned server would get
  inbound dispatch but never see broadcasts. Fix: the provider adds the server's
  `WebSocketBroadcast` as one more sink in its fan-out. Small change; makes Path C
  coherent. (Path C QA itself remains a follow-up.)
- `server.onWebSocketConnect` gains close semantics: the callback may return a cleanup
  function which the server invokes when that socket closes.

### Replay trigger semantics (resolves double-replay + reconnect asymmetry)

- **WS clients (both hosts): replay fires on WS connect, and ONLY there.** Reconnects
  (daemon restart, tab wake) get a fresh connect → fresh replay. The SPA's queued
  `webviewReady` message still arrives over the WS, but the daemon's
  `hostActions.onWebviewReady` is a **no-op** — otherwise every page load replays the
  full multi-MB snapshot twice (the SPA posts `webviewReady` on mount; the lazy WS
  client queues it and flushes on open).
- **VS Code webviews: replay fires on `webviewReady`**, as today (webviews have no
  "connect" event; a re-mounted webview re-posts `webviewReady`).

### Message routing table

| Message                                                                                              | Dispatch behavior                                                                                                                                                                  | Host-specific?                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `openClaude`                                                                                         | `launchNewTerminal(...)` with orchestrator state + `o.ptyManager`; register new agents with hook handler                                                                           | No (pty-only for new agents; cwd falls back defaultCwd → homedir via hostBridge) |
| `focusAgent`                                                                                         | resolve agent/lead → `hostActions.focusTerminal`                                                                                                                                   | Yes                                                                              |
| `closeAgent`                                                                                         | if `ptyBacked` → `o.closeExternalOrPtyAgent`; else if `terminalRef` → `hostActions.disposeTerminal` (its `onDidCloseTerminal` handles cleanup); else → `o.closeExternalOrPtyAgent` | Partially (terminalRef branch)                                                   |
| `dismissAwaitingUser`, `saveAgentSeats`, `saveLayout`, `acknowledgeCrash`, `restoreCategoryDefaults` | existing orchestrator methods (verified host-agnostic)                                                                                                                             | No                                                                               |
| `restartAgent`                                                                                       | orchestrator restart with `hostActions.getBypassPermissions()`                                                                                                                     | Flag read only                                                                   |
| `setHooksEnabled`                                                                                    | `o.setHooksEnabled(enabled, deps.hookScriptSourcePath)`                                                                                                                            | Path dep only                                                                    |
| `setWatchAllSessions`                                                                                | **the workspace-aware prune** (see below) — NOT the plain settings fall-through                                                                                                    | No (after unification)                                                           |
| all other `set*` settings messages                                                                   | existing `o.handleSettingsMessage`                                                                                                                                                 | No                                                                               |
| `requestDiagnostics`                                                                                 | build report, post to `ctx.replySink` — deliberate change from today's broadcast-sink post (a diagnostics reply belongs to its requester)                                          | No                                                                               |
| `webviewReady`                                                                                       | `hostActions.onWebviewReady(ctx)`                                                                                                                                                  | Yes                                                                              |
| `exportLayout`                                                                                       | `hostActions.exportLayout()`                                                                                                                                                       | Yes                                                                              |
| `importLayout` **with inline `layout` payload**                                                      | validate (`version === 1`, `tiles` array) → `writeLayoutToFile` → broadcast `layoutLoaded`                                                                                         | No (new; used by browser)                                                        |
| `importLayout` without payload                                                                       | `hostActions.importLayoutViaDialog()`                                                                                                                                              | Yes (extension keeps dialog flow)                                                |
| `openExternal` (field: `uri`)                                                                        | `hostActions.openExternal(uri)`                                                                                                                                                    | Yes                                                                              |
| `openSessionsFolder`                                                                                 | `hostActions.openSessionsFolder()`                                                                                                                                                 | Yes (daemon no-op, per scoping)                                                  |
| `addExternalAssetDirectory`                                                                          | `hostActions.pickExternalAssetDirectory()` → orchestrator add + rebroadcast                                                                                                        | Yes (daemon no-op)                                                               |
| `removeExternalAssetDirectory`                                                                       | orchestrator remove by `path`                                                                                                                                                      | No                                                                               |
| `ptyInput`, `ptyResize`, `terminalPaneReady`                                                         | NOT in this dispatch — handled by `PtyManager.attachSource` (existing)                                                                                                             | —                                                                                |

### `setWatchAllSessions` unification (behavior divergence found in review)

Two implementations exist today and disagree: the provider's
(`handleSetWatchAllSessions`) prunes only externals whose `projectDir` is outside the
workspace; the orchestrator's (`handleSettingsMessage`) removes ALL externals. Unify on
one workspace-aware implementation in the orchestrator using
`host().workspaceFolders()`:

- Extension host bridge returns real folders ⇒ current extension semantics preserved.
- Daemon bridge returns `[]` ⇒ every external is "outside" ⇒ current daemon semantics
  preserved.

Delete the provider copy. This is the only routing-table row where "already
host-agnostic" required a code change to become true.

### Multi-client pty: per-client scrollback (pre-existing bug, fixed here)

`terminalPaneReady` replies currently go to the **broadcast** sink, and `TerminalPane`
appends scrollback without clearing — so a second client opening a pane duplicates the
full scrollback into every other client's live pane (reproducible today with side-panel

- full-screen webviews). Fix: `ensurePtyManager(source, replySink)` — `PtyManager`
  sends `ptyScrollback` to the requesting client's `replySink`; live `ptyData` stays on
  the broadcast sink. The extension passes a per-webview sink wrapper; the daemon passes
  `perClientSink`. Signature change is additive (replySink optional, falls back to
  broadcast) so existing tests migrate incrementally.

### WS close disposal (verified missing in review)

`WebSocketSource` has no close hook and `ensurePtyManager` currently discards
`attachSource`'s disposable — every reconnect permanently grows PtyManager's
subscription list. Required: the server invokes the connect-callback's returned cleanup
on socket close (see wiring sketch), which disposes both the UI dispatch subscription
and the pty attachment. The wsServer integration test asserts no growth across
connect/close cycles.

## Part 2 — Snapshot replay contract (blocker 2)

### Shape fixes in `daemon/snapshotReplay.ts`

The orchestrator's caches already hold correctly-named inner data
(`charSprites.characters`, `floorTiles.sprites`, `wallTiles.sets`,
`{catalog, sprites}`), so this is output-field renaming plus two payload completions:

| Message                  | fixed payload                                                                                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `characterSpritesLoaded` | `{ characters }`                                                                                                                                                                                                                                                                                                            |
| `floorTilesLoaded`       | `{ sprites }`                                                                                                                                                                                                                                                                                                               |
| `wallTilesLoaded`        | `{ sets }`                                                                                                                                                                                                                                                                                                                  |
| `furnitureAssetsLoaded`  | `{ catalog, sprites }` (spread the cached object)                                                                                                                                                                                                                                                                           |
| `settingsLoaded`         | flat spread of `buildSettingsPayload()` (webview reads `msg.soundEnabled` etc.)                                                                                                                                                                                                                                             |
| `existingAgents`         | `{ agents: number[], agentMeta, folderNames, externalAgents, terminalNames, ptyBackedAgents }` — ALL SIX keys; `ptyBackedAgents` is load-bearing (gates the terminal pane; omitting it breaks reloaded tabs). Extract `buildExistingAgentsPayload(agents)` from `agentManager.sendExistingAgents` and use it in both places |
| `hookHealthChanged`      | `{ status, reason, since }` — replay currently sends `{ state }`, parser reads `msg.status`/`msg.reason` (the 8th drifted message; missing from the QA table)                                                                                                                                                               |
| `layoutLoaded`           | unchanged (already correct) — but see fresh-install fallback below                                                                                                                                                                                                                                                          |

`SnapshotDeps` getters change accordingly. Both call sites (WS connect,
`replaySnapshotToSink`) pick the fixes up automatically.

### Fresh-install layout fallback

`replaySnapshot` skips `layoutLoaded` when `readLayoutFromFile()` returns null, and the
daemon never writes the default layout to disk — so once BrowserMock is gated off, a
fresh `~/.pixel-agents` install would render a blank office and strand `pendingAgents`
(they flush only on `layoutLoaded`). Fix: replay's `getLayout` falls back to the
orchestrator's cached `defaultLayout` (mirroring what `orchestrator.start()`
broadcasts). No disk write.

### Contract test: `daemon/__tests__/snapshotReplay.contract.test.ts`

Run `replaySnapshot` against representative deps with a capturing sink; assert **exact
top-level keys per message type** against a `MESSAGE_CONTRACT` table (all 8 message
types above, with the full six-key `existingAgents` row). The table lives in the test
with a comment block pointing at the corresponding `useExtensionMessages.ts` parse
sites (the file cannot be imported across the webview-ui project boundary — the comment
is the cross-link). Also assert: `existingAgents` ids are numbers, `settingsLoaded`
carries no nested `settings` key, `hookHealthChanged` carries no `state` key, and
replay emits messages in the documented order (assets → state → per-agent). The
existing `daemon/__tests__/snapshotReplay.test.ts` asserts the current WRONG shapes and
must be updated in the same commit.

### BrowserMock gating

`main.tsx` currently always runs `initBrowserMock()` when `isBrowserRuntime`. With
replay fixed, daemon-served pages would build the office twice (mock assets, then WS
replay). Gate the mock on transport availability: skip `initBrowserMock` when the
`px-token` meta tag is present (injected by `daemon/staticServer.ts`; daemon-served
page ⇒ real WS will provide everything). `vite dev` standalone (no meta tag) keeps the
mock. `App.tsx`'s `dispatchMockMessages()` call gets the same guard.

## Part 3 — Browser layout export/import

Client-side, in the settings-actions layer (`App.tsx` — the export/import senders are
props passed into the settings V2 component from `App.tsx`), branch on
`isBrowserRuntime` (same pattern as `webLinkHandler.ts`):

- **Export**: download the **last-saved state**: the SPA keeps the most recent
  `layoutLoaded` payload verbatim (as received, pre-`migrateLayoutColors` mutation) and
  serializes THAT — matching the extension, which exports the saved file. Never export
  live unsaved editor state. `Blob` → anchor-download `pixel-agents-layout.json`. No
  server round-trip.
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
- `TerminalPaneStub.tsx`: replace the stale copy referencing the deleted "Use in-panel
  terminal" setting with runtime-appropriate text (e.g. "This agent runs outside Pixel
  Agents — its transcript is being watched, but there is no terminal to attach.").

## Testing

- **Unit**: `uiDispatch` table tests (each message → expected orchestrator/hostActions
  call, using stub deps); `importLayout` inline-payload validation (rejects bad
  version/tiles); contract test per Part 2; `setWatchAllSessions` prune matrix
  (workspace folders present vs empty).
- **Integration**: extend `daemon/__tests__/wsServer.integration.test.ts` — client
  sends `setSoundEnabled` over a real WS → `config.json` updated; sends `openClaude` →
  agent appears in a subsequent broadcast; connect/close cycles do not grow pty or
  dispatch subscriptions; two clients: second `terminalPaneReady` does NOT emit
  scrollback to the first client's sink.
- **Extension regression**: existing suite must stay green (provider delegation is
  behavior-preserving except the two deliberate changes: `requestDiagnostics` →
  replySink, unified `setWatchAllSessions`).
- **Manual/Playwright re-run** of QA Path B after implementation: + Agent spawns,
  terminal echoes keystrokes, settings toggle writes `config.json`, layout edit syncs
  to a second tab, import/export round-trips in the browser, reload after daemon
  restart replays cleanly (single replay, no duplicate scrollback).

## Risks

- The provider `webviewReady` block move is the riskiest edit (190 lines of first-boot
  init). Mitigation: move verbatim into `hostActions.onWebviewReady`, no logic edits,
  rely on the extension test suite + a Path-A smoke test.
- The pty `replySink` signature change touches `PtyManager` call sites in both hosts;
  the optional-parameter design keeps old behavior where not passed.
- Extension broadcast bridging (WS clients) is new surface on the extension path; it is
  additive (one more sink) and Path C QA remains explicitly pending.

## Amendments (2026-08-16, from plan review)

1. **`saveLayout` broadcasts `layoutLoaded` to all clients** after writing the file.
   `markLayoutWrite()` suppresses the file-watcher echo, which in single-process daemon
   mode was the only sync channel — without this broadcast, a save in tab A never
   reaches tab B, and browser export goes stale. The origin client receives the echo
   too; the webview's dirty-editor guard keeps last-save-wins semantics. This also
   covers the extension's own multi-webview sync, which had the same latent gap.
2. **`DispatchContext.isWsClient?: boolean`.** WS-origin messages are marked by the
   host's connect wiring. The extension's `onWebviewReady` returns immediately for WS
   clients — they already got their replay on connect (prevents Path C double replay,
   and prevents a WS client's `webviewReady` from triggering the extension's first-boot
   init block).
3. **`HostActions.onAgentsLaunched(newAgents: AgentState[]): void`.** The provider's
   `openClaude` branch seeds its private `lastSentTerminalNames` map for new agents;
   that side effect moves behind this hook (extension seeds the map; daemon no-op).
4. `cachedFurnitureAssets` is retyped `{ catalog: unknown; sprites?: unknown } | null`
   so the replay dep type-checks without casts.
