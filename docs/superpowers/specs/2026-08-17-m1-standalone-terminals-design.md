# M1: Standalone Terminals + Agent Spawn + New-Agent Form — Design

**Date:** 2026-08-17
**Status:** Draft for spec review
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
keeps `createTerminal` + `sendText`; the terminal band and browser spawn paths are
gated to the browser runtime. M2 brings the VS Code surface via
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

- VS Code terminal band / Pseudoterminal (M2). VS Code `launchAgent` behavior is
  untouched.
- Porting our Settings-V2 modal, daemon CLI, or orchestrator (superseded by upstream).
- LAN exposure; teams/pets/carpets/Areas changes (don't break them, don't extend them).

## Part 1 — Protocol (core/asyncapi.yaml → generated messages)

New **ClientMessage** variants (camelCase discriminators, `additionalProperties: false`,
following the `FocusAgent` schema pattern):

| type                | payload                                  | notes                                                         |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `ptyInput`          | `id: number, data: string`               | privileged (arbitrary shell input)                            |
| `ptyResize`         | `id: number, cols: number, rows: number` | privileged                                                    |
| `terminalPaneReady` | `id: number`                             | requests scrollback; reply goes only to the requesting socket |
| `restartAgent`      | `id: number`                             | privileged; respawns the pty for a dead agent                 |

Extended ClientMessage: `launchAgent` gains optional `name?: string` (maps to the new
`customTitle`). `folderPath`/`bypassPermissions` already exist.

New **ServerMessage** variants:

| type             | payload                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `ptyData`        | `id: number, data: string` (UTF-8 text; JSON transport, no binary frames) |
| `ptyExit`        | `id: number, code: number, signal?: string`                               |
| `ptyScrollback`  | `id: number, lines: string[]`                                             |
| `agentRenamed`   | `id: number, customTitle: string`                                         |
| `agentRestarted` | `id: number`                                                              |

Extended ServerMessage: `SettingsLoaded` gains `recentAgentFolders?: string[]`;
`AgentCreated` gains `ptyBacked?: boolean, customTitle?: string`;
`ExistingAgents` gains `ptyBackedAgents?: object, customTitles?: object` (mirroring its
existing per-agent record maps).

Process: edit the YAML, run `npm run asyncapi:generate`, **commit the regenerated
`core/src/messages.ts`** (CI drift gate). Version note: the YAML stays AsyncAPI 3.0.0
(Modelina pin).

## Part 2 — Server: pty host owned by AgentRuntime

**`server/src/ptyManager.ts` (new)** — port `src/pty/ptyManager.ts` + `ptyWorker.ts` +
`ptyProtocol.ts` from `v2-orchestrator` (ring-buffer scrollback, chunk cap,
intentional-stop crash suppression, per-request scrollback reply). Adapt outbound to
`store.broadcast({type:'ptyData', ...})` and scrollback to the per-socket `send` that
`handleClientMessage` already receives — upstream's architecture natively provides the
per-client reply channel our v2 had to add.

**Ownership**: `AgentRuntime` gains `readonly ptys` (the manager) beside its timer
maps. `removeAgent(id)` (`agentRuntime.ts:308`) — the single teardown chokepoint —
kills the agent's pty; `dispose()` disposes all. `restoreExternalAgents()` culls
persisted pty agents (no live process to rebind; same skip treatment terminal agents
get in `agentManager.restoreAgents`).

**Spawn path** (`clientMessageHandler.ts`, new `case 'launchAgent'`): privileged-gated.
Generate sessionId; resolve cwd via a ported `resolveRequestedCwd` (explicit folder
`~`-expanded + validated → `process.cwd()` scan root → homedir); build the command via
`claudeProvider.buildLaunchCommand(sessionId, cwd, {bypassPermissions})` (their
existing provider hook); spawn through the pty manager with a login shell;
**pre-register the expected `<projectDir>/<sessionId>.jsonl` in
`runtime.knownJsonlFiles`** (prevents the double-adoption ghost the scanner would
otherwise create); create the `AgentState` (a sixth, host-owned creation path) with new
fields `ptyBacked: true`, `customTitle?`, `terminalName` (display); `store.set(...)`
(emits `agentAdded` → `agentCreated` fan-out — extend the two hand-mapped
`agentCreated` frame builders in `httpServer.ts:172` and `PixelAgentsViewProvider.ts:124`
with `ptyBacked`/`customTitle`); `runtime.registerAgent(sessionId, id)`; if `name`,
broadcast `agentRenamed` and persist; if explicit folder, update recents (below) and
re-broadcast `settingsLoaded`.

**Types**: `AgentState` gains `ptyBacked?: boolean`, `customTitle?: string` (in
`server/src/types.ts`; do NOT touch the `vscode.Terminal`-typed `terminalRef`).
`PersistedAgent` (`core/src/schemas.ts`) gains the same two optional fields.

**Recents**: new `recentAgentFolders: string[]` in `AdapterSettings` +
`ADAPTER_SETTING_KEYS` (`server/src/configPersistence.ts`), MRU cap 8, only paths that
resolve. Surfaced through `settingsLoaded` (both hosts get it for free via the shared
settings builder).

**Privilege model**: `ptyInput`, `ptyResize`, `restartAgent`, `launchAgent` require
`ctx.privileged` (embedded, or standalone `?token=` — the URL the CLI prints).
`terminalPaneReady` is read-only-ish but reveals session content → also privileged.
Unprivileged sockets remain viewers, consistent with upstream's model.

**Multi-server note**: hook events fan out to every live server; a session spawned by
this server will be adopted by a concurrently-running VS Code embedded server as an
external/headless agent (renderable as a ghost via their existing setting). Accepted
behavior for M1; documented, not fought.

## Part 3 — Webview: terminal band + New-agent form (browser runtime only)

**Layout restructure** (the one piece of App surgery): App root becomes
`flex flex-col`; the office (canvas + all its absolute overlays + BottomToolbar etc.)
moves into a `flex-1 relative min-h-0 overflow-hidden` wrapper **with its own ref**,
which is what `ToolOverlay` and `IntroBubble` now receive (fixes the
overlay-projection divergence the exploration flagged — labels/context gauges would
otherwise drift by the band height). The terminal band is a sibling below: ported
`TerminalPane` (xterm.js + FitAddon + SearchAddon + WebLinksAddon), agent-rail strip,
drag-handle resize (throttled; canvas `ResizeObserver` already handles reflow).
Rendered only when `isBrowserRuntime` (and an agent exists) in M1.

**Transport**: all sends via their `transport` singleton; receive branches added to
`useExtensionMessages.ts` (`ptyData`/`ptyExit`/`ptyScrollback`/`agentRenamed`/
`agentRestarted`, plus `recentAgentFolders` in `settingsLoaded` and
`ptyBacked`/`customTitle` in the agent messages). `characterLabel` precedence: port
`customTitle ?? agentName ?? folderName ?? 'Agent #id'` into their `ToolOverlay`
label logic (their `agentName` is the team role; customTitle outranks it, matching v2
semantics).

**Selection semantics**: clicking a character (or rail cell) in the browser selects
the agent's terminal tab **client-side**; `focusAgent` is still sent (harmless no-op
server-side) so VS Code semantics are untouched. Sub-agent → parent and teammate →
lead redirections reuse the existing `meta.parentAgentId` / `leadAgentId` logic so
canvas clicks and rail clicks agree.

**Styling constraints (from their lint/CSS regime)**: xterm font + theme colors live
in `webview-ui/src/constants.ts` (the exempt path for their `pixel-font` and
`no-inline-colors` ESLint errors); `index.css` gains an explicit
`.xterm, .xterm * { font-family: var(--terminal-font); }` override (their universal
`* { font-pixel }` rule would otherwise re-break the terminal exactly as it did in
v2 — same bug, same fix, different mechanics); all sizes are literal pixels
(`--spacing: 1px`); band chrome uses `.pixel-panel` + `.pixel-scrollbar`;
`boxShadow` values use the `2px 2px 0px` idiom (their `pixel-shadow` rule).

**+ Agent / New-agent form**: remove the `!isBrowserRuntime` gate on the + Agent
block (**keep the exact "+ Agent" label — their e2e locates the webview frame by
it**). Port the form (name, folder with `~` placeholder-default, recents quick-picks,
skip-permissions checkbox, Enter-only-from-text-fields, dialog role) onto their
`Modal`; add the missing `Input` primitive to `components/ui/`. VS Code multi-root
dropdown flow stays as-is for M1.

## Part 4 — Tests and CI gates

- **Vitest (server)**: port `ptyManager` tests from v2 (fake worker/source patterns);
  new `clientMessageHandler` cases per routing row (launchAgent spawn + preregistration
  - name/recents; pty routing; privilege denials for unprivileged sockets) using their
    `createTestAgent()` + temp-HOME patterns.
- **Webview node tests**: port `newAgentSpawn` payload tests; label-precedence test.
- **e2e**: new `e2e/tests/standalone/terminal.spec.ts` (spawn from browser via mock
  claude → pane appears → keystroke echo → close) and a New-agent-form spec.
  **Update `clickAddAgent`/`addAgentForFolder` helpers in lockstep** (the form changes
  the click flow they encode) and regenerate `e2e/README.md` (blocking inventory drift
  gate).
- **Packaging**: `node-pty` added to root `dependencies` + `buildCli` externals in
  `esbuild.js` (the documented fastify precedent) + `dist/node_modules/node-pty`-style
  copy is NOT their pattern — npm installs it at the user's machine for `npx`;
  `npm-package-contract.mjs` untouched unless the artifact list changes. The VSIX
  contract's `node_modules` ban is **not relaxed** (M2 uses Pseudoterminal).

## Risks

- **Their spawn-detection pipeline assumptions**: JSONL pre-registration and the
  10s `/resume` fallback in `agentManager` are VS Code-path code; the standalone spawn
  path re-implements only the pre-registration + poll pieces it needs from the
  v2-orchestrator reference, not the terminal-name matching.
- **Webview destroyed on VS Code panel hide** (no `retainContextWhenHidden`): a
  browser-only band avoids this in M1, but scrollback-replay-on-ready is built now
  (server-side ring buffer) so M2 inherits it.
- **Throughput**: pty output rides JSON WS frames with no cap; the ported chunking
  (`PTY_MAX_CHUNK_BYTES`) plus the ring buffer bound memory; backpressure beyond that
  is out of scope for a localhost-only transport.
- **Runtime/schema conformance is conventional** (their `AgentCreated` already sends
  undeclared fields): we declare our extensions in the YAML anyway so the drift gate
  keeps meaning something.
