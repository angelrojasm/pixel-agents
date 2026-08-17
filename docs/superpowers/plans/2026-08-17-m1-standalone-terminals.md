# M1: Standalone Terminals + Agent Spawn + New-Agent Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The standalone browser app can spawn Claude agents (via + Agent or the New-agent form) with live in-office pty terminals, without changing VS Code behavior.

**Architecture:** node-pty host (`server/src/pty/`) injected into `AgentRuntime` by `cli.ts` only (extension bundle stays native-module-free); protocol additions via the AsyncAPI codegen; privileged-only delivery for pty output; browser-gated terminal band + New-agent form in the shared webview. Port sources live on branch `v2-orchestrator` — read them with `git show v2-orchestrator:<path>`; adapt, don't rewrite.

**Tech Stack:** TypeScript strict (Node16 modules), node-pty, xterm.js (+fit/search/web-links addons), Fastify WS (existing), Vitest (`server/`), Playwright e2e, React 19 + Vite + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-17-m1-standalone-terminals-design.md`

## Global Constraints

- **M1 must not change VS Code behavior**: no edits to `adapters/vscode/agentManager.ts` launch flow, no VS Code UI changes beyond the additive `agentCreated` frame fields; `e2e/tests/claude/**` and its helpers are untouched.
- Protocol changes ONLY via `core/asyncapi.yaml` → `npm run asyncapi:generate` → commit `core/src/messages.ts` (CI drift gate). Never hand-edit the generated file. YAML stays AsyncAPI **3.0.0**.
- Pty frames use `id` (upstream convention), not v2's `agentId` — rename while porting.
- `ptyData`/`ptyExit`/`ptyScrollback`/`agentCrashed` are delivered to **privileged sockets only**; `ptyInput`/`ptyResize`/`terminalPaneReady`/`restartAgent`/`launchAgent` are accepted from privileged sockets only.
- Pty agents: `ptyBacked: true`, `isExternal: false`; retained after `ptyExit`; `restartAgent` reuses the same `sessionId`.
- ESLint custom rules: font families and color literals ONLY in `webview-ui/src/constants.ts` (exempt path); `boxShadow` must use `2px 2px 0px`; Tailwind `--spacing: 1px` (all spacing utilities are literal pixels).
- Keep the exact button label **"+ Agent"** (e2e locates the webview frame by it).
- After adding/renaming e2e specs: `npm run e2e:inventory` and commit `e2e/README.md` (blocking drift gate).
- Full check between tasks: `npm run check-types && npm run lint && npm test -w server && npm run test -w webview-ui`. Run `npm run compile` before any commit that touches core/esbuild/packaging.
- Commits: conventional-commit titles (CI lints PR titles); the pre-commit hook runs lint-staged.

---

### Task 1: Protocol — AsyncAPI additions + regenerated messages

**Files:**

- Modify: `core/asyncapi.yaml` (ClientMessage oneOf ~line 125; ServerMessage oneOf ~line 79; variant sections). NOTE: the YAML snippets below are shown at zero indentation — re-indent to the file's `components.schemas` level (4 spaces for schema names, matching `FocusAgent`).
- Generated: `core/src/messages.ts` (via `npm run asyncapi:generate`; commit it)

**Interfaces:**

- Produces (wire shapes all later tasks rely on): ClientMessage `ptyInput {type,id,data}`, `ptyResize {type,id,cols,rows}`, `terminalPaneReady {type,id}`, `restartAgent {type,id}`, `launchAgent` + `name?: string`; ServerMessage `ptyData {type,id,data}`, `ptyExit {type,id,code,signal?}`, `ptyScrollback {type,id,lines}`, `agentCrashed {type,id,code,signal?}`, `agentRenamed {type,id,customTitle}`, `agentRestarted {type,id}`; `SettingsLoaded.recentAgentFolders?: string[]`; `AgentCreated.ptyBacked?/customTitle?`; `ExistingAgents.ptyBackedAgents?/customTitles?`.

- [ ] **Step 1: Add the ClientMessage refs + variant schemas.** In the ClientMessage `oneOf` (after `RequestDiagnostics`), add refs for `PtyInput`, `PtyResize`, `TerminalPaneReady`, `RestartAgent`. In the client-variants section, add (FocusAgent is the template — `additionalProperties: false`, `const` discriminator):

```yaml
PtyInput:
  description: Keystrokes for an agent's pty (privileged).
  type: object
  additionalProperties: false
  required: [type, id, data]
  properties:
    type:
      const: ptyInput
    id:
      type: integer
    data:
      type: string

PtyResize:
  description: Resize an agent's pty (privileged).
  type: object
  additionalProperties: false
  required: [type, id, cols, rows]
  properties:
    type:
      const: ptyResize
    id:
      type: integer
    cols:
      type: integer
    rows:
      type: integer

TerminalPaneReady:
  description: Terminal pane mounted; requests scrollback replay (privileged, point-to-point reply).
  type: object
  additionalProperties: false
  required: [type, id]
  properties:
    type:
      const: terminalPaneReady
    id:
      type: integer

RestartAgent:
  description: Respawn a dead agent's pty with the same sessionId (privileged).
  type: object
  additionalProperties: false
  required: [type, id]
  properties:
    type:
      const: restartAgent
    id:
      type: integer
```

Add to `LaunchAgent.properties`:

```yaml
name:
  type: string
  description: Optional display name for the new agent (customTitle).
```

- [ ] **Step 2: Add the ServerMessage refs + variant schemas** (`PtyData`, `PtyExit`, `PtyScrollback`, `AgentCrashed`, `AgentRenamed`, `AgentRestarted` — same template; `PtyScrollback.lines` is `type: array, items: {type: string}`; `signal` is optional so NOT in `required`). Extend `SettingsLoaded.properties` with `recentAgentFolders: {type: array, items: {type: string}}`; `AgentCreated.properties` with `ptyBacked: {type: boolean}` and `customTitle: {type: string}`; `ExistingAgents.properties` with `ptyBackedAgents: {type: object, additionalProperties: {type: boolean}}` and `customTitles: {type: object, additionalProperties: {type: string}}` (copy the exact shape of its existing `folderNames` map property).

- [ ] **Step 3: Generate + validate.** Run: `npm run asyncapi:generate && npm run asyncapi:validate && git diff --stat core/src/messages.ts`
      Expected: validation passes; `messages.ts` diff contains the new interfaces (e.g. `export interface PtyInput`).

- [ ] **Step 4: Type-check + commit**

```bash
npm run check-types
git add core/asyncapi.yaml core/src/messages.ts
git commit -m "feat(protocol): pty terminal + agent naming messages"
```

---

### Task 2: Port the pty core to `server/src/pty/`

**Files:**

- Create: `server/src/pty/ringBuffer.ts`, `server/src/pty/ptyWorker.ts`, `server/src/pty/ptyManager.ts`
- Create: `server/__tests__/ptyManager.test.ts`, `server/__tests__/ringBuffer.test.ts`
- Modify: root `package.json` (dependencies: `"node-pty": "^1.0.0"`), `knip.json` (`ignoreDependencies` + `"node-pty"` — the fastify rows are the template), `esbuild.js` (`buildCli`: `external: [...existing, 'node-pty']`)

**Port sources** (`git show v2-orchestrator:<path>`): `src/pty/ringBuffer.ts` (verbatim), `src/pty/ptyWorker.ts` (verbatim — it already uses `import type * as pty from 'node-pty'` + a deferred `require('node-pty')` in the constructor; KEEP that), `src/pty/ptyManager.ts` (adapted), plus tests `src/pty/__tests__/{ptyManager,ringBuffer}.test.ts`.

**Adaptation map for `ptyManager.ts`** (v2 was MessageSink/Source-shaped; upstream dispatch calls methods directly):

- Constructor becomes `constructor(private readonly opts: { broadcast(msg: Record<string, unknown>): void; workerFactory?: (o: PtyWorkerOptions) => PtyWorker })`.
- DELETE `attachSource`/`handleInbound`/subscription plumbing and `src/pty/ptyProtocol.ts` guards (upstream's generated types replace them). Replace with imperative methods:

```ts
write(id: number, data: string): void          // was ptyInput routing
resize(id: number, cols: number, rows: number): void
scrollback(id: number): string[]               // caller sends the point-to-point reply
```

- Rename every outbound frame field `agentId` → `id`; emit via `this.opts.broadcast({ type: 'ptyData', id, data: chunk })` etc.
- KEEP: `start(id, PtyStartOptions)` idempotency, ring-buffer scrollback (`scrollbackCapacity`), `PTY_MAX_CHUNK_BYTES` chunking, `intentionallyStopped` set gating `agentCrashed` (broadcast `{type:'agentCrashed', id, code, signal}` only when exit is non-zero/signalled AND not intentionally stopped; `ptyExit` always), `stop(id)`, `has(id)`, `disposeAll()`.
- Constants: add `PTY_MAX_CHUNK_BYTES = 1_048_576` and `PTY_SCROLLBACK_MAX_LINES = 2000` to `server/src/constants.ts` (v2's actual values, verified at `git show v2-orchestrator:server/src/constants.ts:79-83`).

**Interfaces:**

- Produces: `class PtyManager` as above + `interface PtyStartOptions {shell, args, cwd, env, cols, rows, scrollbackCapacity?}` (exported from `server/src/pty/ptyManager.ts`). Consumed by Tasks 3, 5, 6, 8.

- [ ] **Step 1: Port `ringBuffer.ts` + its test verbatim; run** `npm test -w server -- ringBuffer` → PASS.
- [ ] **Step 2: Port `ptyWorker.ts` verbatim** (only import-path fixes). It must NOT import node-pty at module top level except `import type`.
- [ ] **Step 3: Port + adapt `ptyManager.test.ts`** per the adaptation map — the fake-worker (`makeFakeWorker`) and recording-broadcast patterns port directly; rewrite the old source-emission tests as direct method calls (`mgr.write(1,'x')` instead of `src.emit({type:'ptyInput',...})`); keep the crash-suppression and scrollback tests. Run to verify FAIL (module missing).
- [ ] **Step 4: Write `ptyManager.ts` per the adaptation map.** Run: `npm test -w server -- ptyManager` → PASS.
- [ ] **Step 5: Packaging.** Add the dependency + esbuild external + knip entry. Run: `npm install && npm run compile` → clean (extension bundle must still build — node-pty is NOT in its externals and must not be reached from `adapters/vscode`).
- [ ] **Step 6: Commit** — `git add server/ core/ package.json package-lock.json knip.json esbuild.js && git commit -m "feat(server): port node-pty host (manager/worker/ring buffer) from v2-orchestrator"`

---

### Task 3: AgentRuntime accepts an injected pty host

**Files:**

- Modify: `server/src/agentRuntime.ts` (fields ~line 60; `removeAgent` at :308; `dispose`)
- Test: `server/__tests__/agentRuntime.pty.test.ts` (create; reuse the store/provider stub patterns from existing `server/__tests__/agentRuntime*.test.ts` — check which exist and follow their setup)

**Interfaces:**

- Produces: `setPtyHost(host: PtyManager): void` and `readonly ptyHost: PtyManager | null` (getter over a private field). `removeAgent(id)` calls `this.ptyHost?.stop(id)` FIRST (before watcher/timer teardown); `dispose()` calls `this.ptyHost?.disposeAll()`.

- [ ] **Step 1: Failing test** — construct an `AgentRuntime` with a stub store/provider, inject `{ stop: vi.fn(), disposeAll: vi.fn(), … } as unknown as PtyManager`, seed an agent, call `removeAgent(id)` → expect `stop` called with the id; call `dispose()` → expect `disposeAll` called.
- [ ] **Step 2: Implement** (private `_ptyHost: PtyManager | null = null`; `import type { PtyManager }` — type-only so the extension graph stays clean even at the type level).
- [ ] **Step 3: Run** `npm test -w server` → PASS. **Commit**: `feat(server): AgentRuntime accepts an injected pty host; teardown on removeAgent/dispose`

---

### Task 4: State + persistence fields (types, schemas, recents key)

**Files:**

- Modify: `server/src/types.ts` (AgentState + the `PersistedAgent` copy at ~:90), `core/src/schemas.ts` (`PersistedAgent` at ~:15), `server/src/agentStateStore.ts` (`persist()` projection), `server/src/configPersistence.ts` (`AdapterSettings` + `ADAPTER_SETTING_KEYS` + `DEFAULT_ADAPTER_SETTINGS` at ~:58 + `parseAdapterSettings` at ~:118 — the parser rebuilds field-by-field and silently drops unknown fields, so ALL FOUR sites need the new field), `server/src/fileStateAdapter.ts` (verify `settingNameOf` strips the `pixel-agents.` prefix — it does; no edit, just awareness), `server/src/constants.ts` (`RECENT_AGENT_FOLDERS_MAX = 8`)
- Test: extend `server/__tests__/configPersistence.test.ts` (exists) + `server/__tests__/agentStateStore.test.ts` (check for an existing persist test to extend)

**Interfaces:**

- Produces: `AgentState.ptyBacked?: boolean`, `AgentState.customTitle?: string`, `AgentState.spawnCwd?: string` (the resolved cwd the pty was spawned in — restart needs it; runtime-only, NOT persisted); BOTH `PersistedAgent` copies get `ptyBacked?`/`customTitle?`; `AdapterSettings.recentAgentFolders?: string[]` — the `ADAPTER_SETTING_KEYS` entry is the **bare name `'recentAgentFolders'`** (the array holds unprefixed names; `settingNameOf` strips `pixel-agents.` before matching), while `getSetting`/`setSetting` callers use the full key `'pixel-agents.recentAgentFolders'`; `persist()` writes `ptyBacked`/`customTitle` when set.

- [ ] **Step 1: Failing tests** — (a) configPersistence: `setSetting('pixel-agents.recentAgentFolders', ['/a'])` round-trips through the file adapter **after a reload** (this exercises `parseAdapterSettings`, which would silently drop an un-declared field); (b) store persist: an agent with `ptyBacked: true, customTitle: 'X'` is projected into the persisted record with both fields.
- [ ] **Step 2: Implement the field additions** in all listed sites (types ×2, schemas, persist projection, AdapterSettings + keys array + defaults + parser).
- [ ] **Step 3: Run** `npm test -w server && npm run check-types` → PASS. **Commit**: `feat(server): ptyBacked/customTitle state + recentAgentFolders setting`

---

### Task 5: Standalone spawn module

**Files:**

- Create: `server/src/launchAgentStandalone.ts`
- Test: `server/__tests__/launchAgentStandalone.test.ts` (create; use their temp-HOME redirect + `createTestAgent` patterns from `server/__tests__/clientMessageHandler.test.ts`)

**Port sources:** `git show v2-orchestrator:src/agentManager.ts` — `resolveDefaultCwd` (~~:71) and `resolveRequestedCwd` (~~:90) port near-verbatim (drop the workspace-folders parameter; the standalone chain is explicit folder → `launchCwd` argument → homedir). The transcript-watching calls mirror upstream's own `adapters/vscode/agentManager.ts:144-228` (JSONL poll → `startFileWatching` + `readNewLines`) — copy that flow, not v2's.

**Interfaces:**

- Consumes: `PtyManager.start` (Task 2), runtime fields (`knownJsonlFiles`, `registerAgent`, `startProjectScan`), `claudeProvider.buildLaunchCommand`, store (`set`, `nextAgentId`, `nextTerminalIndex`, `persist`), Task 4 fields.
- Produces:

```ts
export interface LaunchStandaloneOptions {
  folderPath?: string;
  bypassPermissions?: boolean;
  name?: string;
}
export function launchAgentStandalone(
  opts: LaunchStandaloneOptions,
  deps: {
    store: AgentStateStore;
    runtime: AgentRuntime; // must have ptyHost injected; caller guarantees
    provider: HookProvider;
    launchCwd: string; // the CLI's scan root (process.cwd() at startup)
  },
): number | null; // new agent id, or null when no pty host

// ALSO exported (Task 6 consumes it for recents validation):
export function resolveDefaultCwd(raw: string | undefined): string | undefined;
```

Guard: `provider.buildLaunchCommand` is OPTIONAL on `HookProvider`
(`core/src/provider.ts:133`) — if absent, log and return null (no spawn without a
launch command).

Behavior (spec Part 2 sequence): resolve cwd; `sessionId = crypto.randomUUID()`; `buildLaunchCommand(sessionId, cwd, {bypassPermissions})` (guarded — see above); `ptyHost.start(id, {shell: process.env.SHELL ?? '/bin/zsh', args: ['-l','-c', command+args joined], cwd, env: process.env, cols: 80, rows: 24, scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES})`; compute `projectDir` from cwd (reuse the provider's `getSessionDirs` helper at `server/src/providers/hook/claude/claude.ts:77-100`, already used this way by `cli.ts:287` — do NOT duplicate); pre-register `<projectDir>/<sessionId>.jsonl` in `runtime.knownJsonlFiles`; build `AgentState` with `ptyBacked: true, isExternal: false, customTitle: name?.trim() || undefined, spawnCwd: cwd, terminalName: 'Claude Code #'+idx` (match upstream's AgentState required fields — copy the field list from an existing creation site in `server/src/fileWatcher.ts`); `store.set(id, agent)`; `runtime.registerAgent(sessionId, id)`; start the JSONL poll/watch flow; if cwd's projectDir differs from launchCwd's, `runtime.startProjectScan(projectDir)`; `store.persist()`; return id.

- [ ] **Step 1: Failing tests** — with a stubbed pty host + temp HOME: (a) spawn creates exactly one agent with `ptyBacked/isExternal:false/customTitle` set and pty `start` called with cwd + `--session-id` in args; (b) expected JSONL path is in `knownJsonlFiles`; (c) invalid folderPath falls back to `launchCwd`; (d) no pty host → returns null, no agent.
- [ ] **Step 2: Implement.** Run → PASS. **Commit**: `feat(server): standalone pty spawn path (launchAgentStandalone)`

---

### Task 6: Client-message dispatch — launch/pty/restart/recents

**Files:**

- Modify: `server/src/clientMessageHandler.ts` (switch at ~:89; settingsLoaded builder at ~:413-425; setting-key consts ~:66)
- Test: extend `server/__tests__/clientMessageHandler.test.ts`

**Interfaces:**

- Consumes: Tasks 1–5. `ClientMessageContext` gains `launchCwd?: string` and `provider?: HookProvider` (threaded from cli via `HttpServerOptions` in Task 7).

New cases (each gated `if (!ctx.privileged) break;` — same style as `setHooksEnabled`):

```ts
case 'launchAgent': {
  if (!ctx.privileged || !runtime?.ptyHost || !ctx.provider || !ctx.launchCwd) break; // VS Code path keeps its own handler
  const id = launchAgentStandalone(
    { folderPath: msg.folderPath as string | undefined,
      bypassPermissions: msg.bypassPermissions as boolean | undefined,
      name: msg.name as string | undefined },
    { store, runtime, provider: ctx.provider, launchCwd: ctx.launchCwd },
  );
  if (id !== null) {
    const agent = store.get(id);
    if (agent?.customTitle) store.broadcast({ type: 'agentRenamed', id, customTitle: agent.customTitle });
    if (typeof msg.folderPath === 'string' && msg.folderPath.trim()) {
      const raw = msg.folderPath.trim();
      if (resolveDefaultCwd(raw)) {   // only real paths become quick-picks
        const current = adapter?.getSetting<string[]>(KEY_RECENT_AGENT_FOLDERS, []) ?? [];
        const next = [raw, ...current.filter((v) => v !== raw)].slice(0, RECENT_AGENT_FOLDERS_MAX);
        adapter?.setSetting(KEY_RECENT_AGENT_FOLDERS, next);
        sendSettingsLoaded(send, ctx);   // extract the existing inline settingsLoaded builder into this helper first
      }
    }
  }
  break;
}
case 'ptyInput':   if (ctx.privileged) runtime?.ptyHost?.write(msg.id as number, msg.data as string); break;
case 'ptyResize':  if (ctx.privileged) runtime?.ptyHost?.resize(msg.id as number, msg.cols as number, msg.rows as number); break;
case 'terminalPaneReady':
  if (ctx.privileged && runtime?.ptyHost?.has(msg.id as number))
    send({ type: 'ptyScrollback', id: msg.id, lines: runtime.ptyHost.scrollback(msg.id as number) });
  break;
case 'restartAgent': {
  if (!ctx.privileged || !runtime?.ptyHost || !ctx.provider?.buildLaunchCommand) break;
  const id = msg.id as number;
  const agent = store.get(id);
  if (!agent?.ptyBacked || !agent.sessionId) break;
  const cwd = agent.spawnCwd ?? ctx.launchCwd ?? os.homedir(); // spawnCwd recorded at launch (Task 4/5)
  runtime.ptyHost.stop(id); // marks intentionallyStopped → no agentCrashed from the old worker
  const launch = ctx.provider.buildLaunchCommand(agent.sessionId, cwd, {});
  runtime.ptyHost.start(id, {
    shell: process.env.SHELL ?? '/bin/zsh',
    args: ['-l', '-c', [launch.command, ...launch.args].join(' ')],
    cwd, env: process.env, cols: 80, rows: 24,
    scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES,
  });
  store.broadcast({ type: 'agentRestarted', id });
  break;
}
```

**Reconnect (BLOCKER fix from plan review): extend the `existingAgents` builder.**
`handleWebviewReady`'s frame at `clientMessageHandler.ts:482-505` currently sends
`{agents, agentMeta, folderNames, externalAgents}` — add two record maps built the
same way `folderNames` is:

```ts
const ptyBackedAgents: Record<number, boolean> = {};
const customTitles: Record<number, string> = {};
for (const [id, agent] of store.entries()) {
  if (agent.ptyBacked) ptyBackedAgents[id] = true;
  if (agent.customTitle) customTitles[id] = agent.customTitle;
}
send({
  type: 'existingAgents',
  agents,
  agentMeta,
  folderNames,
  externalAgents,
  ptyBackedAgents,
  customTitles,
});
```

Without this, a page reload drops the terminal band and labels (fields declared in
Task 1 and consumed in Task 10 would never be populated).

Also: `settingsLoaded` builder gains `recentAgentFolders: adapter?.getSetting<string[]>(KEY_RECENT_AGENT_FOLDERS, []) ?? []` (standalone builder only). Add `const KEY_RECENT_AGENT_FOLDERS = 'pixel-agents.recentAgentFolders';` beside the other key consts.

- [ ] **Step 1: Failing tests** (recording stub for ptyHost; `privileged: true/false` variants): every row above, including — unprivileged `launchAgent`/`ptyInput` are no-ops; `terminalPaneReady` replies point-to-point via `send` (not broadcast); recents MRU + nonexistent-folder-not-recorded; `settingsLoaded` includes the recents array; restart uses `agent.spawnCwd` and broadcasts `agentRestarted`; **`webviewReady` for a store containing a pty agent emits `existingAgents` with `ptyBackedAgents` + `customTitles` populated** (the reconnect blocker).
- [ ] **Step 2: Implement** (including the `sendSettingsLoaded` extraction — behavior-preserving refactor of the existing inline builder, done first as its own micro-commit if you prefer).
- [ ] **Step 3: Run** `npm test -w server` → PASS. **Commit**: `feat(server): standalone dispatch for launch/pty/restart + recent folders`

---

### Task 7: Privileged-only pty output + agentCreated frame fields

**Files:**

- Modify: `server/src/httpServer.ts` (`registerWebSocketRoute` ~:145-230: `onBroadcast` filter, `onAgentAdded` fields; `HttpServerOptions` gains `provider?: HookProvider` + `launchCwd?: string` threaded into `handleClientMessage` ctx)
- Modify: `server/src/server.ts` (**third threading site** — `PixelAgentsServer.start`'s inline options type at ~:62-73 gains the same two optional fields, forwarded to `createHttpServer` at ~:97; cli calls `server.start`, not `createHttpServer` directly)
- Modify: `adapters/vscode/PixelAgentsViewProvider.ts` (~:124-136 — its `agentCreated` frame builder gains the same two fields; additive only)
- Test: extend `server/__tests__/httpServerWs.test.ts` (the WS behavior test file)

**Interfaces:** consumes Task 1 wire shapes.

- [ ] **Step 1: Failing test** — two WS clients (one with `?token=`, one without): a `store.broadcast({type:'ptyData', id:1, data:'x'})` reaches ONLY the privileged one; a `{type:'agentStatus',...}` broadcast reaches both; `agentCreated` for an agent with `ptyBacked:true, customTitle:'X'` carries both fields.
- [ ] **Step 2: Implement:**

```ts
const PRIVILEGED_ONLY_TYPES = /^pty/; // + agentCrashed below
const onBroadcast = (message: Record<string, unknown>) => {
  const t = String(message.type ?? '');
  if (!privileged && (PRIVILEGED_ONLY_TYPES.test(t) || t === 'agentCrashed')) return;
  safeSend(socket, message);
};
```

and in `onAgentAdded`: `ptyBacked: agent.ptyBacked || undefined, customTitle: agent.customTitle,` (mirror in the VS Code frame builder).

- [ ] **Step 3: Run** `npm test -w server && npm run check-types` → PASS. **Commit**: `feat(server): privileged-only pty output delivery; agentCreated carries ptyBacked/customTitle`

---

### Task 8: CLI wiring

**Files:**

- Modify: `server/src/cli.ts` (construct + inject after `new AgentRuntime(...)`; thread `provider`/`launchCwd` into `server.start(...)` options)
- Test: smoke via existing CLI test if present (`ls server/__tests__ | grep -i cli`), else rely on Task 13's e2e; still add a unit test asserting `AgentRuntime.ptyHost` is set after the wiring function runs if cli.ts exposes a testable seam — if it does not, note it and cover via e2e only.

- [ ] **Step 1: Implement:**

```ts
const ptyHost = new PtyManager({ broadcast: (m) => store.broadcast(m) });
runtime.setPtyHost(ptyHost);
// in server.start options: provider: claudeProvider, launchCwd: process.cwd(),
```

`httpServer` passes both through to `handleClientMessage` ctx (done in Task 7's options change).

- [ ] **Step 2: Manual smoke:** `npm run compile && node dist/cli.js --port 0` → boots; open the printed URL; office renders (no band yet). **Commit**: `feat(cli): construct and inject the pty host`

---

### Task 9: Webview foundations — deps, constants, CSS

**Files:**

- Modify: `webview-ui/package.json` (dependencies: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-web-links` — copy exact versions from `git show v2-orchestrator:webview-ui/package.json`), `webview-ui/src/constants.ts`, `webview-ui/src/index.css`

- [ ] **Step 1: Constants** (the ESLint-exempt home for fonts/colors):

```ts
// Terminal band (M1, browser runtime)
export const TERMINAL_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';
export const TERMINAL_FONT_SIZE_PX = 13;
export const TERMINAL_THEME_BACKGROUND = '#181828';
export const TERMINAL_BAND_DEFAULT_HEIGHT_PX = 260;
export const TERMINAL_BAND_MIN_HEIGHT_PX = 120;
export const TERMINAL_BAND_MAX_HEIGHT_PX = 600;
export const TERMINAL_SCROLLBACK_LINES = 2000; // matches server PTY_SCROLLBACK_MAX_LINES
```

- [ ] **Step 2: index.css** — import xterm css in the band component (not here); add AFTER the universal rule:

```css
/* xterm renders shell content: real monospace, exempt from the pixel font.
   * The universal *-selector rule above would otherwise override xterm's own
   * font on every glyph span (proportional-pixelated + letter-spacing drift). */
.xterm,
.xterm * {
  font-family: var(--terminal-font);
}
```

and define `--terminal-font: Menlo, Monaco, 'Courier New', monospace;` in `:root` (CSS var so the value lives once; the TS constant mirrors it for xterm's ITerminalOptions).

- [ ] **Step 3:** `npm install -w webview-ui && npm run build:webview && npm run lint` → clean. **Commit**: `feat(webview): terminal foundations (xterm deps, constants, css exemption)`

---

### Task 10: Webview message plumbing

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts` (the if/else chain ~:210-740; the `pendingAgents` buffer ~:233-238; settingsLoaded branch)
- Test: `webview-ui/test/pty-messages.test.ts` only if a pure reducer is extracted; otherwise coverage comes from Task 13's e2e. Extract ONE pure helper for testability:

```ts
// webview-ui/src/hooks/ptyEvents.ts (new, pure)
export interface PtyEvent { kind: 'data'|'exit'|'scrollback'|'crashed'|'restarted'; id: number; data?: string; lines?: string[]; code?: number; signal?: string }
export function toPtyEvent(msg: Record<string, unknown>): PtyEvent | null { ... } // maps the five server messages, else null
```

**Interfaces:**

- Produces for Task 11: a `ptyEventBus` (port `git show v2-orchestrator:webview-ui/src/office/panel/ptyEventBus.ts` — a tiny subscribe/emit class; **extend it with `crashed` and `restarted` channels** — v2's bus has only data/exit/scrollback/activity) exposed from the hook's return, fed from the message chain via `toPtyEvent`; React state additions: `recentAgentFolders: string[]`, `ptyBackedByAgent: Record<number, boolean>`, `customTitles: Record<number, string>` (fed by `agentCreated`, `existingAgents` incl. the pendingAgents buffer entries, and `agentRenamed`).

- [ ] **Step 1: Failing test for `toPtyEvent`** (five mappings + null for unknown). Implement. PASS.
- [ ] **Step 2: Wire the chain**: new branches emit onto the bus; `agentCreated`/`existingAgents` branches read the new fields (and the pendingAgents buffer entries carry `ptyBacked`/`customTitle` through the layout-ready flush); `settingsLoaded` branch reads `recentAgentFolders` (Array.isArray guard); `agentRenamed` updates `customTitles`.
- [ ] **Step 3:** `npm run check-types && npm run test -w webview-ui` → PASS. **Commit**: `feat(webview): pty/rename/recents message plumbing`

---

### Task 11: Terminal band UI + App restructure

**Files:**

- Create: `webview-ui/src/components/terminal/TerminalPane.tsx`, `TerminalBand.tsx`, `AgentRail.tsx`, **plus TerminalPane's ported dependencies**: `TerminalSearchBar.tsx`, `useTerminalSearch.ts`, `webLinkHandler.ts` (all from `v2-orchestrator:webview-ui/src/office/panel/`)
- Modify: `webview-ui/src/App.tsx` (root layout ~:400-600; ToolOverlay ref at ~:434; IntroBubble ref at ~:586; selection handlers ~:146,235-241)

**Port sources:** `git show v2-orchestrator:webview-ui/src/office/panel/TerminalPane.tsx` (xterm + FitAddon + SearchAddon + WebLinksAddon + search bar; adaptation: transport singleton instead of `vscode.postMessage`; frames use `id`; fonts/colors from Task 9 constants). The band/rail are SIMPLIFIED ports of v2's `OfficePanel`/`AgentCell` (bottom-only, no left/right positions in M1): rail lists pty-backed agents (label = `customTitle ?? terminalName`), close ✕ sends `closeAgent`, selection is client-side state in App.

**App restructure (spec Part 3):**

```tsx
<div className="w-full h-full flex flex-col">
  <div ref={officeRef} className="flex-1 relative min-h-0 overflow-hidden">
    {/* everything that is inside the root today, unchanged */}
  </div>
  {isBrowserRuntime && hasPtyAgents && (
    <TerminalBand ... />   // fixed px height state, drag handle (pointermove throttled to rAF), .pixel-panel chrome
  )}
</div>
```

`ToolOverlay` (:434) and `IntroBubble` (:586) receive `officeRef` instead of `containerRef`. Character/rail click → `setFocusedTerminalId(resolvedId)` (reusing the existing sub-agent→parent and teammate→lead redirections) and still send `focusAgent`. `ToolOverlay` gains a name row rendering `customTitles[id]` above the team-role row when present.

- [ ] **Step 1: Build the three components** (porting per the map above; `terminalPaneReady` on mount; `ptyInput` on `term.onData`; `ptyResize` from FitAddon on container resize; exit marker + Restart button on `exit` events; crash indicator driven by `crashed` events).
- [ ] **Step 2: App restructure + ref fix + label row.**
- [ ] **Step 3: Manual check in the standalone app:** `npm run compile && node dist/cli.js --port 0`. The transport singleton is NOT on `window`, so spawn from devtools with a raw tokened socket: `const t=new URLSearchParams(location.search).get('token'); const w=new WebSocket(\`ws://${location.host}/ws?token=${t}\`); w.onopen=()=>w.send(JSON.stringify({type:'launchAgent'}));` → character + band + live terminal; typing echoes; labels don't drift when the band resizes.
- [ ] **Step 4:** `npm run check-types && npm run lint && npm run format:check` → clean. **Commit**: `feat(webview): in-office terminal band (browser runtime)`

---

### Task 12: + Agent in the browser + New-agent form

**Files:**

- Create: `webview-ui/src/components/ui/Input.tsx`, `webview-ui/src/components/NewAgentModal.tsx`, `webview-ui/src/components/newAgentSpawn.ts`
- Modify: `webview-ui/src/components/BottomToolbar.tsx` (~:86 gate), `webview-ui/src/App.tsx` (modal state + props)
- Test: `webview-ui/test/new-agent-spawn.test.ts`

**Port sources:** `git show v2-orchestrator:webview-ui/src/components/newAgentSpawn.ts` (verbatim — blank-omits + any-non-blank-folder-sent semantics survived our v2 review) and `NewAgentPopover.tsx` (re-skinned onto upstream's `Modal` as `NewAgentModal`; Enter submits only from text inputs; recents list from `recentAgentFolders`; skip-permissions checkbox; upstream's `Modal` is plain divs with NO `role="dialog"` — add `role="dialog"` + `aria-label` on the modal content yourself).

**BottomToolbar change (browser only):** the `{!isBrowserRuntime && (...)}` wrapper around the + Agent block becomes: in browser runtime, render the **same "+ Agent" button** whose click opens `NewAgentModal` (no hover menu in browser — the form IS the browser flow, since bypass + folder live inside it); in VS Code runtime, the existing hover/dropdown flow is byte-identical. `Input.tsx`: the SettingsModal inline-input styling (`bg-bg border-2 border-border rounded-none text-text`, `fontSize` via a Task 9 constant) extracted as a primitive.

- [ ] **Step 1: Port `newAgentSpawn.ts` + its three tests** — CONVERT the tests from v2's `node:test`/`node:assert` to upstream's vitest (`import { test, expect } from 'vitest'`; every existing `webview-ui/test/*.test.ts` here is vitest). FAIL → implement → PASS.
- [ ] **Step 2: Build `Input` + `NewAgentModal`; wire the toolbar + App.** Submit sends `transport.send({type:'launchAgent', ...buildSpawnRequest(name, folder, bypass)})`.
- [ ] **Step 3: Manual check:** browser + Agent → form → named agent spawns in chosen folder; recents appear on next open; VS Code flow untouched (run `npm run compile` and eyeball the extension webview if convenient — behavior gate is Task 13's untouched `e2e/tests/claude` suite).
- [ ] **Step 4:** all webview checks → clean. **Commit**: `feat(webview): browser + Agent with New-agent form (name, folder, recents)`

---### Task 13: e2e + inventory

**Files:**

- Create: `e2e/tests/standalone/terminal.spec.ts`, `e2e/tests/standalone/new-agent-form.spec.ts` (both tagged `@area:terminal` / `@area:agent-form`)
- Modify: `e2e/helpers/standalone.ts` (`spawnStandaloneHost` ~:100-123 gains mock-claude PATH prepend — the actual mock-PATH code in the VS Code launcher is at `e2e/helpers/launch.ts` ~:210-230; assert mock-won via its invocation log because the `-l` login shell can reorder PATH)
- Generated: `e2e/README.md` (`npm run e2e:inventory`)

- [ ] **Step 1: terminal.spec.ts** — launch standalone (privileged URL from stdout), click **+ Agent** → form → Spawn with defaults; assert: character appears, band appears, mock-claude invocation log non-empty, typed keystroke arrives (scenario-builder mock echoes), kill scenario exits → exit marker + Restart works.
- [ ] **Step 2: new-agent-form.spec.ts** — spawn with Name + explicit temp folder; assert rail label shows the name, `~/.pixel-agents/config.json` (temp HOME) contains the folder at **`standalone.recentAgentFolders`** (namespaced adapter settings, bare key on disk), reopening the form lists it. Also: an **unprivileged** second page (same URL without `?token=`) sees the character but receives no `ptyData` (use the message recorder) — the privilege test.
- [ ] **Step 3:** `npm run e2e:inventory` + commit README. Run the two specs locally: `npx playwright test --config e2e/playwright.config.ts e2e/tests/standalone/terminal.spec.ts e2e/tests/standalone/new-agent-form.spec.ts` → PASS. Because Tasks 10–12 restructure App.tsx/BottomToolbar for BOTH runtimes, run the full **`e2e/tests/claude/hooks-off/` slice** locally as the VS Code-untouched gate (not just one canary) → PASS.
- [ ] **Step 4: Commit**: `test(e2e): standalone terminal + New-agent form specs`

---

### Task 14: Full verification

- [ ] **Step 1:** `npm run compile && npm test -w server && npm run test -w webview-ui && npm run format:check && npm run asyncapi:validate && npm run knip && npm run test:package-contract` → all green (knip + package-contract are CI gates and Task 2 touched deps); `git diff --exit-code core/src/messages.ts e2e/README.md` after regenerating both → no drift.
- [ ] **Step 2:** Manual smoke matching the spec's Goals: standalone spawn/terminal/type/restart/close; form name+folder+recents; unprivileged viewer sees office but no terminal content; VS Code extension F5 unchanged (spawns native terminal exactly as v1.4.1).
- [ ] **Step 3:** Update `docs/` playtest notes with an M1 QA block; commit; run the requesting-code-review flow over the whole M1 branch delta.
