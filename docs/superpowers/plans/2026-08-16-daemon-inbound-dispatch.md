# Daemon Inbound Dispatch + Replay Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone daemon consume inbound WebSocket messages through a dispatch shared with the VS Code extension, fix all snapshot-replay message shapes with a contract test, and add browser layout import/export.

**Architecture:** A new `daemon/uiDispatch.ts` owns the UI message switch for both hosts; host-only actions (dialogs, terminal reveal) route through a `HostActions` interface. WS-connect wiring moves out of the orchestrator into each host (`bin/serve.ts`, provider), which resolves the dispatch↔orchestrator circular dependency and gives WS sockets close-time cleanup. Snapshot replay reuses the live-path payload builders so shapes cannot drift, guarded by a contract test.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, no enums), Vitest (root: `src/`, `bin/`, `daemon/`, `server/`), node test runner (`webview-ui/test/`), esbuild + Vite.

**Spec:** `docs/superpowers/specs/2026-08-16-daemon-inbound-dispatch-design.md`

## Global Constraints

- The daemon must never import `vscode`. Shared modules reach the host only via `src/hostBridge.ts` (`host()`). `import type * as vscode` is allowed (erased).
- `import type` for type-only imports; no `enum`; `noUnusedLocals`/`noUnusedParameters`.
- No inline magic numbers/strings — constants live in `src/constants.ts` / `server/src/constants.ts` / `webview-ui/src/constants.ts`.
- A pre-commit hook runs prettier/eslint on staged files — never bypass it.
- Full check between tasks: `npm test` (vitest root suites) and, when webview files changed, `cd webview-ui && npm test`.
- Replay trigger semantics (spec): WS clients replay on connect ONLY; VS Code webviews replay on `webviewReady`. Daemon `onWebviewReady` is a no-op.
- Browser export exports **last-saved** layout state, never live editor state.

---

### Task 1: Extract `buildExistingAgentsPayload` in agentManager

**Files:**

- Modify: `src/agentManager.ts` (function `sendExistingAgents`, ~line 593)
- Test: `src/__tests__/existingAgentsPayload.test.ts` (create)

**Interfaces:**

- Produces: `export function buildExistingAgentsPayload(agents: Map<number, AgentState>): { agents: number[]; agentMeta: Record<number, { palette: number; hueShift: number; workSeatId?: string }>; folderNames: Record<number, string>; externalAgents: Record<number, boolean>; terminalNames: Record<number, string>; ptyBackedAgents: Record<number, boolean> }` — used by Task 2's replay deps and by `sendExistingAgents` itself.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/existingAgentsPayload.test.ts
import { describe, expect, it } from 'vitest';
import { buildExistingAgentsPayload } from '../agentManager';
import type { AgentState } from '../types';

function agent(partial: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 's',
    projectDir: '/p',
    jsonlFile: '/p/s.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    palette: 0,
    hueShift: 0,
    ...partial,
  } as AgentState;
}

describe('buildExistingAgentsPayload', () => {
  it('builds all six keys with sorted numeric ids', () => {
    const agents = new Map<number, AgentState>([
      [2, agent({ id: 2, palette: 1, hueShift: 45, workSeatId: 'seat-1', folderName: 'proj' })],
      [1, agent({ id: 1, isExternal: true, ptyBacked: true })],
    ]);
    const p = buildExistingAgentsPayload(agents);
    expect(Object.keys(p).sort()).toEqual([
      'agentMeta',
      'agents',
      'externalAgents',
      'folderNames',
      'ptyBackedAgents',
      'terminalNames',
    ]);
    expect(p.agents).toEqual([1, 2]);
    expect(p.agentMeta[2]).toEqual({ palette: 1, hueShift: 45, workSeatId: 'seat-1' });
    expect(p.folderNames).toEqual({ 2: 'proj' });
    expect(p.externalAgents).toEqual({ 1: true });
    expect(p.ptyBackedAgents).toEqual({ 1: true });
    expect(p.agents.every((id) => typeof id === 'number')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/existingAgentsPayload.test.ts`
Expected: FAIL — `buildExistingAgentsPayload` is not exported.

- [ ] **Step 3: Implement by extraction**

In `src/agentManager.ts`, move the body of `sendExistingAgents` between the guard and the `postMessage` into a new exported function; `sendExistingAgents` becomes:

```ts
export function buildExistingAgentsPayload(agents: Map<number, AgentState>): {
  agents: number[];
  agentMeta: Record<number, { palette: number; hueShift: number; workSeatId?: string }>;
  folderNames: Record<number, string>;
  externalAgents: Record<number, boolean>;
  terminalNames: Record<number, string>;
  ptyBackedAgents: Record<number, boolean>;
} {
  // …verbatim body currently in sendExistingAgents (agentIds sort, agentMeta,
  // folderNames/externalAgents/ptyBackedAgents, terminalNames loops)…
  return {
    agents: agentIds,
    agentMeta,
    folderNames,
    externalAgents,
    terminalNames,
    ptyBackedAgents,
  };
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  webview: MessageSink | undefined,
): void {
  if (!webview) return;
  const payload = buildExistingAgentsPayload(agents);
  console.log(
    `[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(payload.agents)}, meta=${JSON.stringify(payload.agentMeta)}`,
  );
  webview.postMessage({ type: 'existingAgents', ...payload });
}
```

- [ ] **Step 4: Run the test + the whole extension suite**

Run: `npx vitest run src/__tests__/existingAgentsPayload.test.ts && npm test`
Expected: PASS everywhere (extraction is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add src/agentManager.ts src/__tests__/existingAgentsPayload.test.ts
git commit -m "refactor: extract buildExistingAgentsPayload from sendExistingAgents"
```

---

### Task 2: Fix snapshotReplay shapes + fresh-install layout fallback + contract test

**Files:**

- Modify: `daemon/snapshotReplay.ts` (whole `SnapshotDeps` + `replaySnapshot`)
- Modify: `daemon/orchestrator.ts` — BOTH dep sites: the `server.onWebSocketConnect` block (~407–423) and `replaySnapshotToSink` (~690–706)
- Modify: `daemon/__tests__/snapshotReplay.test.ts` (asserts the old wrong shapes)
- Test: `daemon/__tests__/snapshotReplay.contract.test.ts` (create)

**Interfaces:**

- Produces (new `SnapshotDeps`, consumed by orchestrator + Task 7/8 wiring):

```ts
export interface SnapshotDeps {
  sink: MessageSink;
  getCharacterSprites: () => unknown; // sent as { characters }
  getFloorTiles: () => unknown; // sent as { sprites }
  getWallTiles: () => unknown; // sent as { sets }
  getFurnitureAssets: () => { catalog: unknown; sprites?: unknown }; // spread
  getExistingAgentsPayload: () => Record<string, unknown>; // spread (Task 1 builder)
  getLayout: () => Record<string, unknown> | null;
  getSettings: () => Record<string, unknown>; // spread FLAT
  getHookHealth: () => { status: string; reason?: string; since?: number } | null; // spread
  getRenamedAgents: () => Array<{ id: number; customTitle: string }>;
  getTeamInfo: () => Array<{
    id: number;
    teamName?: string;
    agentName?: string;
    isTeamLead?: boolean;
    leadAgentId?: number;
  }>;
  getTerminalNameChanges: () => Array<{ id: number; terminalName: string }>;
  getActiveAgentStatuses: () => Array<{ id: number; status: string; [k: string]: unknown }>;
}
```

- [ ] **Step 1: Write the contract test (fails against current shapes)**

```ts
// daemon/__tests__/snapshotReplay.contract.test.ts
//
// CONTRACT: field names below MUST match the parsers in
// webview-ui/src/hooks/useExtensionMessages.ts:
//   characterSpritesLoaded → msg.characters   (~line 536)
//   floorTilesLoaded       → msg.sprites      (~line 544)
//   wallTilesLoaded        → msg.sets         (~line 548)
//   furnitureAssetsLoaded  → msg.catalog + msg.sprites (~line 596)
//   settingsLoaded         → flat msg.soundEnabled etc. (~line 555)
//   existingAgents         → msg.agents:number[] + agentMeta/folderNames/
//                            externalAgents/terminalNames/ptyBackedAgents (~line 291)
//   hookHealthChanged      → msg.status / msg.reason  (~line 661)
//   layoutLoaded           → msg.layout       (~line 191)
// The webview project cannot be imported across the project boundary; this
// comment is the cross-link. If you change either side, change both.
import { describe, expect, it } from 'vitest';
import { replaySnapshot } from '../snapshotReplay';

const REQUIRED_KEYS: Record<string, string[]> = {
  characterSpritesLoaded: ['characters'],
  floorTilesLoaded: ['sprites'],
  wallTilesLoaded: ['sets'],
  furnitureAssetsLoaded: ['catalog', 'sprites'],
  existingAgents: [
    'agents',
    'agentMeta',
    'folderNames',
    'externalAgents',
    'terminalNames',
    'ptyBackedAgents',
  ],
  layoutLoaded: ['layout'],
  settingsLoaded: ['soundEnabled'],
  hookHealthChanged: ['status'],
};
const FORBIDDEN_KEYS: Record<string, string[]> = {
  characterSpritesLoaded: ['sprites'],
  floorTilesLoaded: ['tiles'],
  wallTilesLoaded: ['tiles'],
  furnitureAssetsLoaded: ['assets'],
  existingAgents: [],
  settingsLoaded: ['settings'],
  hookHealthChanged: ['state'],
};

function deps(sink: { postMessage(m: unknown): Promise<void> }) {
  return {
    sink,
    getCharacterSprites: () => [['x']],
    getFloorTiles: () => [['x']],
    getWallTiles: () => [[['x']]],
    getFurnitureAssets: () => ({ catalog: [{ id: 'DESK' }], sprites: { DESK: [['x']] } }),
    getExistingAgentsPayload: () => ({
      agents: [1],
      agentMeta: { 1: { palette: 0, hueShift: 0 } },
      folderNames: {},
      externalAgents: {},
      terminalNames: {},
      ptyBackedAgents: { 1: true },
    }),
    getLayout: () => ({ version: 1, tiles: [] }),
    getSettings: () => ({ soundEnabled: true, alwaysShowLabels: false }),
    getHookHealth: () => ({ status: 'ok', reason: undefined, since: 5 }),
    getRenamedAgents: () => [{ id: 1, customTitle: 'T' }],
    getTeamInfo: () => [],
    getTerminalNameChanges: () => [],
    getActiveAgentStatuses: () => [{ id: 1, status: 'active' }],
  };
}

describe('snapshotReplay message contract', () => {
  it('emits webview-parseable shapes in documented order', async () => {
    const messages: Array<Record<string, unknown>> = [];
    await replaySnapshot(
      deps({ postMessage: async (m) => void messages.push(m as Record<string, unknown>) }),
    );
    const types = messages.map((m) => m.type);
    expect(types.slice(0, 8)).toEqual([
      'characterSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'furnitureAssetsLoaded',
      'existingAgents',
      'layoutLoaded',
      'settingsLoaded',
      'hookHealthChanged',
    ]);
    for (const m of messages) {
      const t = m.type as string;
      for (const k of REQUIRED_KEYS[t] ?? []) expect(m, `${t} needs ${k}`).toHaveProperty(k);
      for (const k of FORBIDDEN_KEYS[t] ?? [])
        expect(k in m, `${t} must not have ${k}`).toBe(false);
    }
    const existing = messages.find((m) => m.type === 'existingAgents')!;
    expect((existing.agents as unknown[]).every((id) => typeof id === 'number')).toBe(true);
  });

  it('falls back is caller-provided: emits layoutLoaded whenever getLayout returns non-null', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const d = deps({ postMessage: async (m) => void messages.push(m as Record<string, unknown>) });
    d.getLayout = () => null;
    await replaySnapshot(d);
    expect(messages.map((m) => m.type)).not.toContain('layoutLoaded');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run daemon/__tests__/snapshotReplay.contract.test.ts`
Expected: FAIL — type errors on `SnapshotDeps` (`getExistingAgentsPayload` missing) and/or key assertions.

- [ ] **Step 3: Rewrite `replaySnapshot` message emission**

In `daemon/snapshotReplay.ts`, replace the deps interface with the one in **Interfaces** above, and phase 1–2 emission with:

```ts
await deps.sink.postMessage({
  type: 'characterSpritesLoaded',
  characters: deps.getCharacterSprites(),
});
await deps.sink.postMessage({ type: 'floorTilesLoaded', sprites: deps.getFloorTiles() });
await deps.sink.postMessage({ type: 'wallTilesLoaded', sets: deps.getWallTiles() });
await deps.sink.postMessage({ type: 'furnitureAssetsLoaded', ...deps.getFurnitureAssets() });
await deps.sink.postMessage({ type: 'existingAgents', ...deps.getExistingAgentsPayload() });
const layout = deps.getLayout();
if (layout) await deps.sink.postMessage({ type: 'layoutLoaded', layout });
await deps.sink.postMessage({ type: 'settingsLoaded', ...deps.getSettings() });
const health = deps.getHookHealth();
if (health) await deps.sink.postMessage({ type: 'hookHealthChanged', ...health });
```

Phase 3 (per-agent replays) is unchanged.

- [ ] **Step 4: Update the two orchestrator dep sites**

In `daemon/orchestrator.ts`, in BOTH `server.onWebSocketConnect` (~407) and `replaySnapshotToSink` (~690), replace:

```ts
getExistingAgents: () => getAgentIds(agents).map((id) => ({ id })),
getLayout: () => readLayoutFromFile(),
getHookHealth: () => server.getHealthState()?.status ?? null,
```

with:

```ts
getExistingAgentsPayload: () => buildExistingAgentsPayload(agents),
getLayout: () => readLayoutFromFile() ?? defaultLayout,     // fresh-install fallback
getHookHealth: () => {
  const h = server.getHealthState();
  return h ? { status: h.status, reason: h.reason, since: h.since } : null;
},
```

Add `buildExistingAgentsPayload` to the existing `../src/agentManager.js` import. Delete the now-unused `getAgentIds` helper if nothing else uses it.

- [ ] **Step 5: Update `daemon/__tests__/snapshotReplay.test.ts`**

It asserts the old shapes (e.g. `toEqual({ type: 'settingsLoaded', settings })` at ~line 46). Update its fixtures to the new `SnapshotDeps` and its assertions to the new flat/renamed shapes; keep its ordering + optionality cases (`layoutLoaded` skipped when null, `hookHealthChanged` skipped when null) — those semantics are unchanged.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, including both replay test files.

- [ ] **Step 7: Commit**

```bash
git add daemon/snapshotReplay.ts daemon/orchestrator.ts daemon/__tests__/
git commit -m "fix(daemon): snapshot replay speaks the webview contract; add contract test"
```

---

### Task 3: PtyManager per-client scrollback + disposable attachments

**Files:**

- Modify: `src/pty/ptyManager.ts`
- Test: extend `src/pty/__tests__/ptyManager.test.ts` (existing file; add cases)

**Interfaces:**

- Produces: `PtyManagerOptions.source` becomes optional; `PtyManagerOptions.replySink?: MessageSink`; `attachSource(source: MessageSource, replySink?: MessageSink): { dispose(): void }` — `ptyScrollback` goes to that subscription's `replySink ?? opts.sink`; `ptyData`/`ptyExit` stay on `opts.sink`. Consumed by Task 5's `ensurePtyManager`.

- [ ] **Step 1: Write failing tests**

Add to `src/pty/__tests__/ptyManager.test.ts` (reuse the file's existing fake worker/source helpers — follow its local patterns):

```ts
it('sends ptyScrollback to the requesting subscription replySink, not broadcast', async () => {
  const broadcast: unknown[] = [];
  const replyA: unknown[] = [];
  const mgr = new PtyManager({ sink: { postMessage: async (m) => void broadcast.push(m) } });
  const srcA = fakeSource(); // file-local helper: { onMessage(h) {…}, emit(m) {…} }
  mgr.attachSource(srcA, { postMessage: async (m) => void replyA.push(m) });
  mgr.start(1, fakeStartOpts());
  srcA.emit({ type: 'terminalPaneReady', agentId: 1 });
  expect(replyA.some((m) => (m as { type: string }).type === 'ptyScrollback')).toBe(true);
  expect(broadcast.some((m) => (m as { type: string }).type === 'ptyScrollback')).toBe(false);
});

it('a disposed attachment stops receiving inbound messages', () => {
  const written: string[] = [];
  const mgr = new PtyManager({ sink: { postMessage: async () => {} } });
  const src = fakeSource();
  const sub = mgr.attachSource(src);
  mgr.start(1, fakeStartOpts({ onWrite: (d) => written.push(d) }));
  sub.dispose();
  src.emit({ type: 'ptyInput', agentId: 1, data: 'x' });
  expect(written).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pty/__tests__/ptyManager.test.ts`
Expected: FAIL — constructor requires `source`; scrollback goes to broadcast.

- [ ] **Step 3: Implement**

```ts
// PtyManagerOptions: source?: MessageSource; replySink?: MessageSink;
constructor(private readonly opts: PtyManagerOptions) {
  this.factory = opts.workerFactory ?? ((o) => new PtyWorker(o));
  this.subscription = opts.source
    ? opts.source.onMessage((m) => this.handleInbound(m, opts.replySink))
    : { dispose: () => {} };
}

attachSource(source: MessageSource, replySink?: MessageSink): { dispose(): void } {
  return source.onMessage((m) => this.handleInbound(m, replySink));
}

private handleInbound(message: Record<string, unknown>, replySink?: MessageSink): void {
  // …ptyInput / ptyResize unchanged…
  if (isTerminalPaneReadyMessage(message)) {
    const w = this.workers.get(message.agentId);
    if (!w) return;
    void (replySink ?? this.opts.sink).postMessage({
      type: 'ptyScrollback',
      agentId: message.agentId,
      lines: w.scrollback(),
    });
    return;
  }
}
```

- [ ] **Step 4: Run pty tests + full suite** — `npm test` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/pty/
git commit -m "fix(pty): per-client scrollback replies; disposable source attachments"
```

---

### Task 4: WS connect callbacks return close-time cleanup

**Files:**

- Modify: `server/src/server.ts` (`wsConnectHandler` type ~line 62, `onWebSocketConnect` ~line 80, upgrade handler ~line 166)
- Test: extend `daemon/__tests__/wsServer.integration.test.ts`

**Interfaces:**

- Produces: `onWebSocketConnect(cb: (src: WebSocketSource, perClientSink: WebSocketSink, broadcast: WebSocketBroadcast) => (() => void) | void)` — the returned function runs when that socket closes. Consumed by Tasks 7–8.

- [ ] **Step 1: Write failing integration test**

Add to `daemon/__tests__/wsServer.integration.test.ts` (follow its existing start-server/connect-client helpers):

```ts
it('invokes the connect callback cleanup when the socket closes', async () => {
  let cleaned = 0;
  server.onWebSocketConnect(() => () => {
    cleaned += 1;
  });
  const ws = await connectClient(); // existing helper
  ws.close();
  await waitFor(() => cleaned === 1); // existing polling helper
  expect(cleaned).toBe(1);
});
```

- [ ] **Step 2: Run to verify failure** — cleanup never invoked; test times out/fails.
- [ ] **Step 3: Implement**

In the upgrade handler:

```ts
this.wss!.handleUpgrade(req, sock, head, (ws) => {
  this.wsClients.add(ws);
  const cleanup = this.wsConnectHandler?.(
    new WebSocketSource(ws),
    new WebSocketSink(ws),
    this.wsBroadcast,
  );
  ws.on('close', () => {
    this.wsClients.delete(ws);
    if (typeof cleanup === 'function') cleanup();
  });
});
```

(The current separate `ws.on('close', …)` registration merges into this one.)

- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit**

```bash
git add server/src/server.ts daemon/__tests__/wsServer.integration.test.ts
git commit -m "feat(server): WS connect callbacks may return close-time cleanup"
```

---

### Task 5: Orchestrator — workspace-aware Watch-All prune, new `ensurePtyManager`, drop connect block

**Files:**

- Modify: `daemon/orchestrator.ts`
- Test: extend `daemon/__tests__/orchestrator.test.ts` (exists; follow its stub patterns)

**Interfaces:**

- Produces: `ensurePtyManager(source: MessageSource, replySink?: MessageSink): { dispose(): void }` (interface ~line 171 + impl ~line 479); `handleSettingsMessage('setWatchAllSessions', …)` prunes only externals whose `projectDir` is outside `host().workspaceFolders()`. The orchestrator no longer registers `server.onWebSocketConnect` (hosts do, Tasks 7–8).

- [ ] **Step 1: Write failing tests**

```ts
it('setWatchAllSessions(false) keeps externals inside the host workspace', () => {
  // Arrange: hostBridge stub returning one workspace folder whose
  // getProjectDirPath(...) equals agentInWorkspace.projectDir (use setHostBridge
  // from src/hostBridge with a test double; restore defaultbridge in afterEach).
  // Two external agents: one inside, one outside.
  o.handleSettingsMessage('setWatchAllSessions', { enabled: false });
  expect(agents.has(insideId)).toBe(true);
  expect(agents.has(outsideId)).toBe(false);
});

it('setWatchAllSessions(false) with empty workspace prunes all externals (daemon)', () => {
  o.handleSettingsMessage('setWatchAllSessions', { enabled: false });
  expect([...agents.values()].some((a) => a.isExternal)).toBe(false);
});

it('ensurePtyManager returns a disposable per source', () => {
  const sub = o.ensurePtyManager(fakeSource());
  expect(typeof sub.dispose).toBe('function');
});
```

- [ ] **Step 2: Run to verify failures.**
- [ ] **Step 3: Implement**

(a) In `handleSettingsMessage`'s `setWatchAllSessions` disable branch, replace `if (agent.isExternal)` with the workspace-aware filter (mirrors the provider's `handleSetWatchAllSessions`, which Task 7 deletes):

```ts
const workspaceDirs = new Set<string>();
for (const folder of host().workspaceFolders()) {
  const dir = getProjectDirPath(folder.path);
  if (dir) workspaceDirs.add(dir);
}
for (const [id, agent] of agents) {
  if (agent.isExternal && !workspaceDirs.has(agent.projectDir)) toRemove.push(id);
}
```

Import `host` from `../src/hostBridge.js`; match `getProjectDirPath`'s actual signature/location (used by the provider — import from the same module). Note the `HostBridge.workspaceFolders()` return element type — use its real field name for the fs path (check `src/hostBridge.ts`; adjust `folder.path` accordingly).

(b) `ensurePtyManager`:

```ts
ensurePtyManager(source: MessageSource, replySink?: MessageSink): { dispose(): void } {
  if (ptyRef.manager === null) {
    ptyRef.manager = new PtyManager({ sink: broadcastSink });
  }
  return ptyRef.manager.attachSource(source, replySink);
},
```

Update the interface declaration (~line 171) to match.

(c) Delete the whole `server.onWebSocketConnect((_src, perClientSink, _broadcast) => …)` block (~406–423). `replaySnapshotToSink` remains the single replay entry point.

- [ ] **Step 4: Run** `npm test` → PASS (some orchestrator tests may reference the removed block's behavior — update them to call `replaySnapshotToSink` directly).
- [ ] **Step 5: Commit**

```bash
git add daemon/orchestrator.ts daemon/__tests__/
git commit -m "refactor(orchestrator): workspace-aware watch-all prune; disposable ensurePtyManager; hosts own WS wiring"
```

---

### Task 6: `daemon/uiDispatch.ts` — the shared message switch

**Files:**

- Create: `daemon/uiDispatch.ts`
- Test: `daemon/__tests__/uiDispatch.test.ts` (create)

**Interfaces:**

- Consumes: orchestrator methods (`dismissAwaitingUser`, `closeExternalOrPtyAgent`, `saveAgentSeats`, `markLayoutWrite`, `setHooksEnabled(enabled, extensionPath?)`, `handleSettingsMessage`, `restoreCategoryDefaults`, `broadcastSettingsLoaded`, `registerAgentHook`, `reloadAndSendCharacters`, `reloadAndSendFurniture`, plus state refs used by `launchNewTerminal` — mirror the provider's `openClaude` branch argument list exactly); `launchNewTerminal`, `restartPty` from `src/agentManager`; `readConfig`/`writeConfig` from `src/configPersistence`; `writeLayoutToFile`, `readLayoutFromFile` from `src/layoutPersistence`.
- Produces (consumed by Tasks 7–8):

```ts
export interface HostActions {
  focusTerminal(agent: AgentState, lead?: AgentState): void;
  disposeTerminal(agent: AgentState): void;
  exportLayout(): Promise<void>;
  importLayoutViaDialog(): Promise<void>;
  openExternal(uri: string): void;
  openSessionsFolder(): void;
  pickExternalAssetDirectory(): Promise<string | null>;
  getBypassPermissions(): boolean;
  onWebviewReady(ctx: DispatchContext): Promise<void>;
}
export interface DispatchContext {
  replySink: MessageSink;
}
export function createUiDispatch(deps: {
  orchestrator: Orchestrator;
  agents: Map<number, AgentState>;
  broadcastSink: MessageSink;
  config: ConfigStore;
  persistAgents: () => void;
  hookScriptSourcePath?: string;
  hostActions: HostActions;
}): { handle(message: Record<string, unknown>, ctx: DispatchContext): Promise<void> };
```

- [ ] **Step 1: Write the failing table test** (one `it` per routing row; stub orchestrator records calls)

```ts
// daemon/__tests__/uiDispatch.test.ts — representative cases; cover EVERY row:
it('openClaude calls launchNewTerminal-path and registers new agents', async () => { /* stub agents map gains id 7 during launch; expect registerAgentHook(7) */ });
it('focusAgent routes to hostActions.focusTerminal with lead fallback', async () => { … });
it('closeAgent: ptyBacked → closeExternalOrPtyAgent', async () => { … });
it('closeAgent: terminalRef → hostActions.disposeTerminal', async () => { … });
it('closeAgent: external → closeExternalOrPtyAgent', async () => { … });
it('saveLayout marks own write then persists', async () => { … });
it('setHooksEnabled forwards deps.hookScriptSourcePath', async () => { … });
it('setWatchAllSessions goes through o.handleSettingsMessage (not the provider copy)', async () => { … });
it('requestDiagnostics posts agentDiagnostics to ctx.replySink, not broadcast', async () => { … });
it('webviewReady calls hostActions.onWebviewReady', async () => { … });
it('importLayout with valid inline layout writes file + broadcasts layoutLoaded', async () => { … });
it('importLayout with bad payload (version !== 1) writes nothing', async () => { … });
it('importLayout without payload → hostActions.importLayoutViaDialog', async () => { … });
it('openExternal reads message.uri', async () => { … });
it('restartAgent uses hostActions.getBypassPermissions and broadcasts agentRestarted on success', async () => { … });
it('addExternalAssetDirectory: null pick is a no-op', async () => { … });
it('removeExternalAssetDirectory filters config and rebroadcasts dirs', async () => { … });
it('unknown set* falls through to o.handleSettingsMessage', async () => { … });
```

Write real stub objects (plain objects with recording arrays); no mocking library — the repo's daemon tests use hand-rolled stubs.

- [ ] **Step 2: Run to verify failures** (module doesn't exist).
- [ ] **Step 3: Implement `createUiDispatch`**

Port each branch from `PixelAgentsViewProvider.handleWebviewMessage` (lines 301–701) verbatim, with these substitutions:

- `this.agents` → `deps.agents`; `this.broadcastSink` → `deps.broadcastSink`; `this.config` → `deps.config`; `this.persistAgentsFn` → `deps.persistAgents`; `o` → `deps.orchestrator`.
- `focusAgent`: keep the agent/lead resolution, end with `deps.hostActions.focusTerminal(agent, lead)` (host decides what "show" means).
- `closeAgent`: `ptyBacked` → `o.closeExternalOrPtyAgent`; `agent.terminalRef` → `deps.hostActions.disposeTerminal(agent)`; else `o.closeExternalOrPtyAgent`.
- `setHooksEnabled`: `o.setHooksEnabled(enabled, deps.hookScriptSourcePath)` — the orchestrator method already wraps install/uninstall + copyHookScript; do NOT re-implement the provider's inline copy.
- `setWatchAllSessions`: forward to `o.handleSettingsMessage('setWatchAllSessions', message)`.
- `requestDiagnostics`: identical body, final post to `ctx.replySink`.
- `exportLayout` / `openSessionsFolder` / `openExternal` / `addExternalAssetDirectory` (dialog part): route to `hostActions`; the config-mutation + `reloadAndSend*` + `externalAssetDirectoriesUpdated` rebroadcast around `pickExternalAssetDirectory` stays IN the dispatch (shared).
- `importLayout`: if `message.layout` is an object, run the validation + write + broadcast inline (shared, no host dialog); else `hostActions.importLayoutViaDialog()`.
- `restartAgent`: `const bypass = deps.hostActions.getBypassPermissions();` then the existing `restartPty(...)` call.
- `webviewReady`: `await deps.hostActions.onWebviewReady(ctx)`.
- Fall-through: `deps.orchestrator.handleSettingsMessage(...)` exactly as the provider does today.

No `vscode` import anywhere in this file (type-only imports fine).

- [ ] **Step 4: Run** `npx vitest run daemon/__tests__/uiDispatch.test.ts && npm test` → PASS. Also run `node esbuild.js` — `buildDaemon()` must still succeed (no vscode in the daemon graph).
- [ ] **Step 5: Commit**

```bash
git add daemon/uiDispatch.ts daemon/__tests__/uiDispatch.test.ts
git commit -m "feat(daemon): shared UI message dispatch with HostActions seam"
```

---

### Task 7: Provider adopts the shared dispatch + WS bridging

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts` (delete the 301–701 switch + `handleSetWatchAllSessions`; add hostActions + dispatch + WS connect registration + broadcast bridging)
- Test: `src/__tests__/providerDispatch.test.ts` (create — delegation smoke test with a stubbed dispatch)

**Interfaces:**

- Consumes: `createUiDispatch`, `HostActions`, `DispatchContext` (Task 6); `onWebSocketConnect` cleanup form (Task 4); `ensurePtyManager(source, replySink)` (Task 5).

- [ ] **Step 1: Build the provider's `HostActions`** — each body moved verbatim from the deleted branches:

```ts
private buildHostActions(): HostActions {
  return {
    focusTerminal: (agent, lead) => (agent.terminalRef ?? lead?.terminalRef)?.show(),
    disposeTerminal: (agent) => agent.terminalRef?.dispose(),
    exportLayout: async () => { /* moved lines 606–619 */ },
    importLayoutViaDialog: async () => { /* moved lines 652–671 */ },
    openExternal: (uri) => { /* moved lines 673–680 */ },
    openSessionsFolder: () => { /* moved lines 601–605 */ },
    pickExternalAssetDirectory: async () => { /* dialog part of 620–628; return fsPath or null */ },
    getBypassPermissions: () =>
      !!this.context.workspaceState.get<boolean>('pixel-agents.bypassPermissions', false),
    onWebviewReady: async (ctx) => { /* moved lines 387–575 verbatim; the per-view replay
      at 557–562 uses ctx.replySink instead of building perViewSink from originWebview */ },
  };
}
```

`handleWebviewMessage` becomes:

```ts
private async handleWebviewMessage(message: Record<string, unknown>, originWebview?: vscode.Webview): Promise<void> {
  const replySink: MessageSink = originWebview
    ? { postMessage: (m) => void originWebview.postMessage(m) }
    : this.broadcastSink;
  await this.uiDispatch.handle(message, { replySink });
}
```

Construct `this.uiDispatch = createUiDispatch({ orchestrator, agents: this.agents, broadcastSink: this.broadcastSink, config: this.config, persistAgents: this.persistAgentsFn, hookScriptSourcePath: this.context.extensionPath, hostActions: this.buildHostActions() })` where the orchestrator is created. Delete `handleSetWatchAllSessions` (Task 5 unified it) and any now-unused imports.

- [ ] **Step 2: WS bridging + connect registration** (extension-owned server, Path C):

```ts
// in the provider constructor, after the server exists:
this.pixelAgentsServer.onWebSocketConnect((src, perClientSink) => {
  const ptySub = this.orchestrator.ensurePtyManager(src, perClientSink);
  const uiSub = src.onMessage((m) => void this.uiDispatch.handle(m, { replySink: perClientSink }));
  void this.orchestrator.replaySnapshotToSink(perClientSink);
  return () => {
    ptySub.dispose();
    uiSub.dispose();
  };
});
```

And in the provider's `broadcastSink.postMessage` fan-out, additionally post every message to `this.pixelAgentsServer.getBroadcastSink()` so WS clients receive live broadcasts.

Also update the two `ensurePtyManager(webviewMessageSource(...))` call sites (~256, ~291) to pass a per-webview reply sink: `ensurePtyManager(webviewMessageSource(w), { postMessage: (m) => void w.postMessage(m) })`.

- [ ] **Step 3: Delegation test**

```ts
// src/__tests__/providerDispatch.test.ts — with the vscode stub the suite already uses:
it('provider forwards a webview message to the shared dispatch with a per-view replySink', async () => {
  // instantiate provider with stubbed deps; swap this.uiDispatch for a recorder;
  // call the private handler via (provider as any).handleWebviewMessage({type:'saveLayout',layout:{}}, fakeWebview);
  // assert recorder got the message and ctx.replySink posts to fakeWebview.
});
```

- [ ] **Step 4: Run the FULL suite + build** — `npm test && npm run build`. The build's type-check is the real net for missed imports. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(extension): provider delegates to shared uiDispatch; WS clients bridged into broadcast"
```

---

### Task 8: Daemon wiring + end-to-end WS integration tests

**Files:**

- Modify: `bin/serve.ts` (after `createOrchestrator`, before `orchestrator.start()`)
- Create: `daemon/daemonHostActions.ts`
- Test: extend `daemon/__tests__/wsServer.integration.test.ts`

**Interfaces:**

- Consumes: everything above. Produces the working daemon.

- [ ] **Step 1: `daemon/daemonHostActions.ts`**

```ts
import type { HostActions } from './uiDispatch.js';

const na = (what: string) =>
  console.log(`[Pixel Agents] ${what}: not available in browser runtime`);

export function createDaemonHostActions(): HostActions {
  return {
    focusTerminal: () => {}, // browser focus is client-local
    disposeTerminal: () => {}, // daemon agents never have terminalRef
    exportLayout: async () => na('exportLayout'), // browser exports client-side
    importLayoutViaDialog: async () => na('importLayout dialog'),
    openExternal: () => na('openExternal'), // browser opens links client-side
    openSessionsFolder: () => na('openSessionsFolder'),
    pickExternalAssetDirectory: async () => {
      na('addExternalAssetDirectory');
      return null;
    },
    getBypassPermissions: () => false,
    onWebviewReady: async () => {}, // replay happens on WS connect only (spec)
  };
}
```

- [ ] **Step 2: Wire in `bin/serve.ts`**

```ts
const dispatch = createUiDispatch({
  orchestrator,
  agents: orchestrator.agents,
  broadcastSink: server.getBroadcastSink(),
  config,
  persistAgents: orchestrator.doPersist,
  hostActions: createDaemonHostActions(),
});
server.onWebSocketConnect((src, perClientSink) => {
  const ptySub = orchestrator.ensurePtyManager(src, perClientSink);
  const uiSub = src.onMessage((m) => void dispatch.handle(m, { replySink: perClientSink }));
  void orchestrator.replaySnapshotToSink(perClientSink);
  return () => {
    ptySub.dispose();
    uiSub.dispose();
  };
});
```

(If the orchestrator interface does not currently expose `agents`/`doPersist`, add typed getters — check `daemon/orchestrator.ts`'s public interface and extend it minimally.)

- [ ] **Step 3: Failing integration tests, then run them**

```ts
it('setSoundEnabled over WS persists to the config store', async () => {
  const ws = await connectClient();
  ws.send(JSON.stringify({ type: 'setSoundEnabled', enabled: false }));
  await waitFor(() => config.get('pixel-agents.soundEnabled') === false);
});

it('connect/close cycles do not leak pty or dispatch subscriptions', async () => {
  for (let i = 0; i < 3; i++) {
    const ws = await connectClient();
    ws.close();
    await waitFor(closed);
  }
  // assert via a counting fake in ensurePtyManager / recorded cleanups: 3 attach, 3 dispose
});

it('two clients: terminalPaneReady replies only to the requester', async () => {
  const a = await connectClient();
  const b = await connectClient();
  b.send(JSON.stringify({ type: 'terminalPaneReady', agentId: 1 }));
  // collect frames on both sockets for 200ms:
  expect(framesOf(a).filter((f) => f.type === 'ptyScrollback')).toHaveLength(0);
});
```

(For `openClaude` end-to-end, spawning a real pty running `claude` is not test-safe; the dispatch-level openClaude behavior is covered in Task 6, and the manual QA re-run covers it live.)

- [ ] **Step 4: Run** `npm test` and a smoke boot: `npm run build && node dist/bin/serve.js --no-open` then `node dist/bin/serve.js status` + `node dist/bin/serve.js stop`. Expected: boots, status OK, stops clean.
- [ ] **Step 5: Commit**

```bash
git add bin/serve.ts daemon/daemonHostActions.ts daemon/__tests__/
git commit -m "feat(daemon): wire inbound WS dispatch — browser tab can act, not just watch"
```

---

### Task 9: Browser layout export/import

**Files:**

- Create: `webview-ui/src/office/layoutFile.ts`
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts` (layoutLoaded handler ~line 197), `webview-ui/src/App.tsx` (onExportLayout/onImportLayout ~line 538)
- Test: `webview-ui/test/layout-file.test.ts` (create)

**Interfaces:**

- Produces:

```ts
export function rememberSavedLayout(layout: unknown): void; // raw layoutLoaded payload
export function getSavedLayout(): unknown | null;
export function isValidLayout(x: unknown): x is { version: 1; tiles: unknown[] };
export function downloadSavedLayout(doc: Document): boolean; // false when nothing saved
export function pickLayoutFile(doc: Document, onLayout: (layout: unknown) => void): void;
```

- [ ] **Step 1: Failing tests (node test runner — pure parts only)**

```ts
// webview-ui/test/layout-file.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidLayout, rememberSavedLayout, getSavedLayout } from '../src/office/layoutFile.ts';

test('isValidLayout accepts version-1 layouts with tiles', () => {
  assert.equal(isValidLayout({ version: 1, tiles: [] }), true);
  assert.equal(isValidLayout({ version: 2, tiles: [] }), false);
  assert.equal(isValidLayout({ version: 1 }), false);
  assert.equal(isValidLayout(null), false);
});

test('rememberSavedLayout stores the raw payload verbatim', () => {
  const raw = { version: 1, tiles: [0], tileColors: undefined };
  rememberSavedLayout(raw);
  assert.equal(getSavedLayout(), raw); // same reference — never the migrated copy
});
```

Run: `cd webview-ui && npm test` → FAIL (module missing).

- [ ] **Step 2: Implement `layoutFile.ts`**

```ts
let savedLayout: unknown | null = null;
export function rememberSavedLayout(layout: unknown): void {
  savedLayout = layout;
}
export function getSavedLayout(): unknown | null {
  return savedLayout;
}
export function isValidLayout(x: unknown): x is { version: 1; tiles: unknown[] } {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as { version?: unknown }).version === 1 &&
    Array.isArray((x as { tiles?: unknown }).tiles)
  );
}
export function downloadSavedLayout(doc: Document): boolean {
  if (!savedLayout) return false;
  const blob = new Blob([JSON.stringify(savedLayout, null, 2)], { type: 'application/json' });
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = LAYOUT_EXPORT_FILENAME; // add to webview-ui/src/constants.ts: 'pixel-agents-layout.json'
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
export function pickLayoutFile(doc: Document, onLayout: (layout: unknown) => void): void {
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidLayout(parsed)) onLayout(parsed);
        else console.warn('[Pixel Agents] import: invalid layout file');
      } catch {
        console.warn('[Pixel Agents] import: unparseable layout file');
      }
    });
  };
  input.click();
}
```

- [ ] **Step 3: Hook the raw payload + the App branches**

In `useExtensionMessages.ts` `layoutLoaded` handler, before migration: `rememberSavedLayout(msg.layout);` (raw, pre-`migrateLayoutColors`). In `App.tsx`:

```tsx
onExportLayout={() =>
  isBrowserRuntime ? downloadSavedLayout(document)
                   : vscode.postMessage({ type: 'exportLayout' })}
onImportLayout={() =>
  isBrowserRuntime ? pickLayoutFile(document, (layout) => vscode.postMessage({ type: 'importLayout', layout }))
                   : vscode.postMessage({ type: 'importLayout' })}
```

- [ ] **Step 4: Run** `cd webview-ui && npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/office/layoutFile.ts webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/App.tsx webview-ui/src/constants.ts webview-ui/test/layout-file.test.ts
git commit -m "feat(webview): browser layout export (download) and import (file picker)"
```

---

### Task 10: Gate BrowserMock off daemon-served pages

**Files:**

- Modify: `webview-ui/src/runtime.ts`, `webview-ui/src/main.tsx`, `webview-ui/src/App.tsx` (~line 49)
- Test: `webview-ui/test/runtime-mock-gate.test.ts` (create)

**Interfaces:**

- Produces: `export function shouldUseBrowserMock(doc: Pick<Document, 'querySelector'>): boolean` in `runtime.ts` — true only when browser runtime AND no `meta[name="px-token"]`.

- [ ] **Step 1: Failing test**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldUseBrowserMock } from '../src/runtime.ts';

const doc = (hasToken: boolean) => ({
  querySelector: (sel: string) => (hasToken && sel === 'meta[name="px-token"]' ? {} : null),
});

test('mock runs on vite-dev pages (no px-token meta)', () => {
  assert.equal(shouldUseBrowserMock(doc(false) as never), true);
});
test('mock is skipped on daemon-served pages (px-token present)', () => {
  assert.equal(shouldUseBrowserMock(doc(true) as never), false);
});
```

(If `isBrowserRuntime` is a module const that is false under node, have `shouldUseBrowserMock` take the runtime flag as an optional second parameter defaulting to `isBrowserRuntime`, and pass `true` in tests.)

- [ ] **Step 2: Implement + guard call sites**

`main.tsx`: `if (shouldUseBrowserMock(document)) { const { initBrowserMock } = await import('./browserMock.js'); await initBrowserMock(); }`. Same guard replaces the `isBrowserRuntime` check around `dispatchMockMessages()` in `App.tsx`.

- [ ] **Step 3: Run** `cd webview-ui && npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Commit**

```bash
git add webview-ui/src/runtime.ts webview-ui/src/main.tsx webview-ui/src/App.tsx webview-ui/test/runtime-mock-gate.test.ts
git commit -m "fix(webview): browser mock only runs when no daemon transport is present"
```

---

### Task 11: Riders — tab identity + stale terminal-stub copy

**Files:**

- Modify: `webview-ui/index.html`, `webview-ui/src/components/TerminalPaneStub.tsx` (~line 41)

- [ ] **Step 1: index.html**

```html
<link
  rel="icon"
  href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%231e1e2e'/%3E%3Crect x='3' y='4' width='10' height='7' fill='%237c6df2'/%3E%3Crect x='5' y='12' width='6' height='1' fill='%237c6df2'/%3E%3C/svg%3E"
/>
<title>Pixel Agents</title>
```

(Delete the `vite.svg` link. The data-URI is self-contained — nothing to copy into `dist/webview/`.)

- [ ] **Step 2: TerminalPaneStub copy** — replace the paragraph referencing "Use in-panel terminal" with:

```
This agent runs outside Pixel Agents — its session transcript is being watched,
but there is no terminal to attach here.
```

- [ ] **Step 3: Verify + commit**

Run: `cd webview-ui && npx tsc --noEmit && npm run build` (root) — confirm `dist/webview/index.html` contains the new title.

```bash
git add webview-ui/index.html webview-ui/src/components/TerminalPaneStub.tsx
git commit -m "polish: Pixel Agents tab identity; fix stale watch-only terminal copy"
```

---

### Task 12: Full verification + live re-QA

- [ ] **Step 1:** `npm test` (root) and `cd webview-ui && npm test` — everything green.
- [ ] **Step 2:** `npm run build` — clean; `node esbuild.js` daemon bundle has no vscode.
- [ ] **Step 3:** Live daemon smoke (mirrors QA doc Path B; note the "quit VS Code first" / back-up `server.json` caveat): boot `node dist/bin/serve.js --no-open`, drive the browser: **+ Agent spawns a character AND an xterm pane; typing echoes; Settings sound-toggle writes `~/.pixel-agents/config.json`; layout edit syncs to a second tab; export downloads; import round-trips; reload replays once with zero console TypeErrors.**
- [ ] **Step 4:** Update `docs/playtests/2026-05-17-phase-2-plus-3-qa.md` with a "QA Session 2" block recording the re-run results.
- [ ] **Step 5:** Commit docs; run the requesting-code-review flow for the whole branch delta.
