# M1: Standalone Terminals + Agent Spawn + New-Agent Form — Design

**Date:** 2026-08-17 (revised same day after spec review; 13 findings folded in)
**Status:** Reviewed — ready for implementation planning
**Base:** upstream pixel-agents v1.4.1 (`3537e14`), now `main` of this fork.
**Reference implementation:** branch `v2-orchestrator` / tag `v2.0.0` — our previous
architecture, containing battle-tested pty, terminal-pane, and New-agent-form code to
port (never rewrite from scratch what exists there).

## Context

Upstream's standalone browser app is a **viewer**: `launchAgent` is unimplemented in
`server/src/clientMessageHandler.ts` (the `default:` branch no-ops it), the "+ Agent"
button is hidden under `!isBrowserRuntime` (`webview-ui/src/components/BottomToolbar.tsx:86`),
and nothing in `server/` or `core/` ever spawns a process. There is no terminal
rendering anywhere in the product; `core/src/terminalAdapter.ts` is a read-only
name-lookup used solely for VS Code terminal adoption.

M1 makes the standalone app a full workstation: spawn Claude agents from the browser,
each with a live in-office terminal, created through a New-agent form (name +
starting folder + recents). **M1 does not change VS Code behavior** — the extension
keeps `createTerminal` + `sendText`; the terminal band, the New-agent form, and the
browser spawn path are all gated to the browser runtime (VS Code's + Agent click flow,
including the multi-root dropdown, is untouched, so the existing VS Code e2e suite and
its helpers stay valid). M2 brings the VS Code surface via
`vscode.window.createTerminal({ pty })` (Pseudoterminal — no native module; the VSIX
packaging contract bans `node_modules/`). M3 ports residual polish.

Binding decisions from scoping: internal-only/pragmatic (but protocol changes still go
through the AsyncAPI codegen — it is cheap and CI-enforces drift), standalone-first,
repo already reset to upstream with our work preserved on `v2-orchestrator`.

## Goals

- From the standalone browser app: click **+ Agent** (or the New-agent form) → a pty
  spawns Claude, a character appears, and a terminal pane in a resizable bottom band
  shows the live session; keystrokes flow; close/restart work.
- The New-agent form offers optional Name and Starting folder (with persisted
  recents), exactly as shipped in v2.0.0.
- All protocol additions go through `core/asyncapi.yaml` + `npm run asyncapi:generate`
  (CI drift gate); all upstream CI gates stay green (messages drift, e2e inventory
  drift, custom ESLint rules, format, knip, package contract).

## Non-goals (M1)

- VS Code terminal band / Pseudoterminal / New-agent form in VS Code (all M2). VS Code
  `launchAgent` behavior and the `e2e/tests/claude` suite are untouched.
- Porting our Settings-V2 modal, daemon CLI, or orchestrator (superseded by upstream).
- LAN exposure; teams/pets/carpets/Areas changes (don't break them, don't extend them).

## Part 1 — Protocol (core/asyncapi.yaml → generated messages)

New **ClientMessage** variants (camelCase discriminators, `additionalProperties: false`,
following the `FocusAgent` schema pattern). Field-name note: v2's pty frames used
`agentId`; the new schemas use `id` to match upstream's `FocusAgent`/`CloseAgent`
convention — ported code and tests are renamed accordingly, not copied verbatim.

| type                | payload                                  | notes                                                                                |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `ptyInput`          | `id: number, data: string`               | privileged (arbitrary shell input)                                                   |
| `ptyResize`         | `id: number, cols: number, rows: number` | privileged                                                                           |
| `terminalPaneReady` | `id: number`                             | privileged; requests scrollback; reply goes only to the requesting socket            |
| `restartAgent`      | `id: number`                             | privileged; respawns the pty **with the same sessionId** (v2 `restartPty` semantics) |

Extended ClientMessage: `launchAgent` gains optional `name?: string` (maps to the new
`customTitle`). `folderPath`/`bypassPermissions` already exist.

New **ServerMessage** variants:

| type             | payload                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptyData`        | `id: number, data: string` (UTF-8 text; JSON transport, no binary frames)                                                                                                                                                         |
| `ptyExit`        | `id: number, code: number, signal?: string` — fires on EVERY pty exit                                                                                                                                                             |
| `ptyScrollback`  | `id: number, lines: string[]`                                                                                                                                                                                                     |
| `agentCrashed`   | `id: number, code: number, signal?: string` — only on unintentional non-zero exit; the ported intentional-stop suppression gates exactly this message (v2 semantics); the webview crash indicator + Restart affordance key off it |
| `agentRenamed`   | `id: number, customTitle: string`                                                                                                                                                                                                 |
| `agentRestarted` | `id: number`                                                                                                                                                                                                                      |

Extended ServerMessage: `SettingsLoaded` gains `recentAgentFolders?: string[]`;
`AgentCreated` gains `ptyBacked?: boolean, customTitle?: string`;
`ExistingAgents` gains `ptyBackedAgents?: object, customTitles?: object` (same
per-agent record-map shape as its existing `folderNames`).

**Privileged-only delivery for pty output (security decision):** `ptyData`,
`ptyExit`, `ptyScrollback`, and `agentCrashed` are delivered **only to privileged
sockets**. Terminal output is shell content; upstream's origin gate deliberately
admits unprivileged viewers (and `--host 0.0.0.0` widens that), so output gets the
same protection as input. Mechanism: the per-socket `broadcast` subscription in
`httpServer.ts` (~192–198) gains a filter — message types with the `pty` prefix plus
`agentCrashed` are skipped when `!privileged`. Unprivileged viewers still see
characters, statuses, and `agentRenamed` (a label, not content).

Process: edit the YAML, run `npm run asyncapi:generate`, **commit the regenerated
`core/src/messages.ts`** (CI drift gate). The YAML stays AsyncAPI 3.0.0 (Modelina pin).

## Part 2 — Server: pty host injected into AgentRuntime

**`server/src/ptyManager.ts` (new)** — port from `v2-orchestrator`:
`src/pty/ptyManager.ts`, `src/pty/ptyWorker.ts`, `src/pty/ptyProtocol.ts`, **and
`src/pty/ringBuffer.ts`** (plus their tests). Keep v2's ring-buffer scrollback, chunk
cap, intentional-stop crash suppression, and per-request scrollback reply. Outbound
adapts to `store.broadcast(...)`; scrollback replies use the per-socket `send` that
`handleClientMessage` receives. Keep v2's **deferred `require('node-pty')` inside the
worker** (`import type` at module level) as a second line of defense.

**Ownership — inverted to keep the extension graph clean (build-safety decision):**
`AgentRuntime` does NOT construct the pty manager (the VS Code adapter imports
`AgentRuntime`; constructing node-pty there would drag the native module into the
extension bundle and break `npm run compile`). Instead `AgentRuntime` gains an
optional injected host: `setPtyHost(host: PtyManager)` + `readonly ptyHost` — only
`server/src/cli.ts` constructs and injects it. `removeAgent(id)`
(`agentRuntime.ts:308`, the single teardown chokepoint) kills that agent's pty when a
host is present; `dispose()` disposes all. The extension never injects one, so "M1
does not change VS Code" holds by construction and the extension build's `external`
list is untouched. Add `node-pty` to `knip.json` `ignoreDependencies` (fastify
precedent).

**Spawn path** (`clientMessageHandler.ts`, new `case 'launchAgent'`): privileged-gated;
no-ops (with a debug log) when no pty host is injected (i.e., embedded/VS Code —
that path keeps its own handler). Sequence:

1. Generate `sessionId`; resolve cwd via a ported `resolveRequestedCwd` (explicit
   folder `~`-expanded + existence-validated → server launch cwd → homedir).
2. Build the command via `claudeProvider.buildLaunchCommand(sessionId, cwd,
{bypassPermissions})`; spawn through the pty host with a login shell.
3. **Pre-register the expected `<projectDir>/<sessionId>.jsonl` in
   `runtime.knownJsonlFiles`** (prevents the scanner's double-adoption ghost).
4. Create `AgentState` (a sixth, host-owned creation path): `ptyBacked: true`,
   **`isExternal: false`** (lifecycle decision below), `customTitle?`,
   `terminalName` (display), then `store.set(...)` → `agentAdded` → the `agentCreated`
   fan-out (extend BOTH hand-mapped frame builders — `httpServer.ts:172` and
   `PixelAgentsViewProvider.ts:124` — with `ptyBacked`/`customTitle`).
5. `runtime.registerAgent(sessionId, id)`; **start transcript watching** — the JSONL
   poll → `startFileWatching` + `readNewLines` (ported from the v2/upstream spawn
   references) so tool statuses and the context gauge work; if the chosen folder's
   `projectDir` is outside the CLI's scan root, also `runtime.startProjectScan` for it.
6. If `name`: set + persist `customTitle`, broadcast `agentRenamed`.
7. If explicit folder: update recents (below), re-send `settingsLoaded` (standalone
   builder — see below).

**Lifecycle decisions (from review):** pty agents are `isExternal: false` — this (a)
prevents `agentRuntime.ts:275-279` from auto-removing them on the `SessionEnd` hook
that fires when the pty's Claude exits, and (b) makes `restoreExternalAgents()`
(`:469`, which skips non-externals) implement the "cull persisted pty agents on server
restart" behavior for free. After `ptyExit`, the agent and character are **retained**
— pane shows the exit marker, the Restart affordance appears (driven by
`agentCrashed`/`ptyExit` exactly as in v2), and `restartAgent` respawns with the same
`sessionId`. `closeAgent` removes it (existing standalone branch → `removeAgent` →
pty kill).

**Types**: `AgentState` gains `ptyBacked?: boolean`, `customTitle?: string`
(`server/src/types.ts`; do NOT touch the `vscode.Terminal`-typed `terminalRef`).
`PersistedAgent` is **duplicated** upstream — extend BOTH copies:
`server/src/types.ts:90` (the one the persistence writer and VS Code adapter import)
and `core/src/schemas.ts:15` (the `StateAdapter` copy).

**Recents**: new `recentAgentFolders: string[]` in `AdapterSettings` +
`ADAPTER_SETTING_KEYS` (`server/src/configPersistence.ts`), MRU cap 8, only paths
that resolve. Surfaced via `settingsLoaded` — which is hand-built in TWO places
(`clientMessageHandler.ts:413-425` standalone; `PixelAgentsViewProvider.ts:~589-601`
VS Code); **M1 edits only the standalone builder** (VS Code gets it in M2). Note:
`AdapterSettings` is per-namespace (`standalone` vs `vscode`), so M2's VS Code form
will need a read-through or migration to share the list — accepted, documented.

**Privilege model**: `ptyInput`, `ptyResize`, `terminalPaneReady`, `restartAgent`,
`launchAgent` require `ctx.privileged`; pty output messages are privileged-delivery
(Part 1). Unprivileged sockets remain pure viewers.

**Multi-server note**: hook events fan out to every live server; a session spawned by
this server will be adopted by a concurrently-running VS Code embedded server as an
external/headless agent (renderable as a ghost via their existing setting). Accepted
behavior for M1; documented, not fought.

## Part 3 — Webview: terminal band + New-agent form (browser runtime only)

**Layout restructure** (the one piece of App surgery): App root becomes
`flex flex-col`; the office (canvas + all its absolute overlays + BottomToolbar etc.)
moves into a `flex-1 relative min-h-0 overflow-hidden` wrapper **with its own ref**,
which is what `ToolOverlay` and `IntroBubble` now receive (fixes the
overlay-projection divergence — labels/context gauges would otherwise drift by the
band height). The terminal band is a sibling below: ported `TerminalPane` (xterm.js +
FitAddon + SearchAddon + WebLinksAddon), agent-rail strip, drag-handle resize
(throttled; canvas `ResizeObserver` already handles reflow). Rendered only when
`isBrowserRuntime` (and at least one pty-backed agent exists) in M1.

**Transport**: all sends via their `transport` singleton; receive branches added to
`useExtensionMessages.ts` (`ptyData`/`ptyExit`/`ptyScrollback`/`agentCrashed`/
`agentRenamed`/`agentRestarted`, plus `recentAgentFolders` in `settingsLoaded` and
`ptyBacked`/`customTitle` in `agentCreated`/`existingAgents`). **Reconnect path:** the
standalone handshake sends `existingAgents` before `layoutLoaded`, so agents
materialize through the `pendingAgents` buffer (`useExtensionMessages.ts:233-238`) —
that buffer's entries gain `ptyBacked` + `customTitle` so reloading clients keep the
band and labels.

**Labels**: `customTitle` renders as (a) the rail-cell label, and (b) a new name row
in `ToolOverlay` above the team-role row when present (upstream's overlay has no name
line today). Precedence: `customTitle` > team `agentName` > `folderName`; no generic
"Agent #id" row is added to the overlay (rail cells fall back to `terminalName`).

**Selection semantics**: clicking a character (or rail cell) in the browser selects
the agent's terminal tab **client-side**; `focusAgent` is still sent (harmless no-op
server-side) so VS Code semantics are untouched. Sub-agent → parent and teammate →
lead redirections reuse the existing `meta.parentAgentId` / `leadAgentId` logic so
canvas clicks and rail clicks agree.

**Styling constraints (their lint/CSS regime)**: xterm font + theme colors live in
`webview-ui/src/constants.ts` (the exempt path for their `pixel-font` and
`no-inline-colors` ESLint errors); `index.css` gains an explicit
`.xterm, .xterm * { font-family: var(--terminal-font); }` override (their universal
`* { font-pixel }` rule would otherwise re-break the terminal exactly as it did in
v2); all sizes are literal pixels (`--spacing: 1px`); band chrome uses `.pixel-panel`

- `.pixel-scrollbar`; `boxShadow` uses the `2px 2px 0px` idiom (`pixel-shadow` rule).

**+ Agent / New-agent form (browser only)**: the + Agent block's
`!isBrowserRuntime` gate flips to _show_ it in the browser (**keep the exact
"+ Agent" label — their e2e locates the webview frame by it**), where clicking opens
the ported New-agent form (name, folder with the default as placeholder, recents
quick-picks, skip-permissions checkbox, Enter-only-from-text-fields, dialog role) on
their `Modal`, plus a new `Input` primitive in `components/ui/`. **In VS Code the
component renders exactly as today** — same hover menu, same multi-root dropdown, no
form — so `clickAddAgent`/`addAgentForFolder` and the whole `e2e/tests/claude` suite
are untouched.

## Part 4 — Tests and CI gates

- **Vitest (server)**: port pty tests from v2 (`ptyManager`/`ringBuffer`, fake
  worker/source patterns, renamed `agentId`→`id` frames); new `clientMessageHandler`
  cases per routing row (launchAgent spawn + pre-registration + name/recents; pty
  routing; privilege denials; no-pty-host no-op) using their `createTestAgent()` +
  temp-HOME patterns; a privileged-delivery test for the broadcast filter.
- **Webview node tests**: port `newAgentSpawn` payload tests; label-precedence test.
- **e2e**: new `e2e/tests/standalone/terminal.spec.ts` (spawn from browser via mock
  claude → pane appears → keystroke echo → exit marker → restart) and a
  New-agent-form spec. `spawnStandaloneHost` (`e2e/helpers/standalone.ts:110-122`)
  gains mock-claude `PATH` wiring (the VS Code launcher's pattern at
  `helpers/launch.ts:61`); tests assert the mock won via its invocation log because
  the login-shell (`-l`) re-sources profiles and can reorder `PATH` (macOS
  `path_helper`). **Existing VS Code helpers are NOT touched.** Regenerate
  `e2e/README.md` (blocking inventory drift gate) for the new specs.
- **Packaging**: `node-pty` in root `dependencies` + `buildCli` externals in
  `esbuild.js`; extension build untouched; `knip.json` `ignoreDependencies` entry;
  `npm-package-contract.mjs` untouched; the VSIX `node_modules` ban is not relaxed.

## Risks

- **Their spawn-detection pipeline assumptions**: the standalone spawn path
  re-implements pre-registration + JSONL poll + file watching from the v2/upstream
  references; the VS Code-specific terminal-name matching and `/resume`-newest-file
  fallback are not ported in M1 (plain `--session-id` spawn makes the expected file
  deterministic).
- **Webview destroyed on VS Code panel hide** (no `retainContextWhenHidden`): browser
  band avoids this in M1; the server-side ring buffer + scrollback replay built now is
  what M2 inherits.
- **Throughput**: pty output rides JSON WS frames; ported chunking
  (`PTY_MAX_CHUNK_BYTES`) + the ring buffer bound memory; deeper backpressure is out
  of scope for a localhost transport.
- **Runtime/schema conformance is conventional** upstream (their `AgentCreated`
  already sends undeclared fields); we declare our extensions in the YAML anyway.
