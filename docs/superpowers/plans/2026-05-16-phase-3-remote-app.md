# Phase 3 — Remote App v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift Pixel Agents out of the VS Code extension into a standalone Node.js daemon that serves the existing `webview-ui/` SPA over HTTP + WebSocket. Localhost-only. Personal tool. Combined Phase 2+3 release.

**Architecture:** Incremental refactor on `2026-05-12-terminal-polish`. Seven migration phases. Phases 1–5 keep the extension working as a safety net; phases 6–7 are the cutover. Reuses existing `MessageSink` / `MessageSource` abstractions — only the transport changes. See [`docs/superpowers/specs/2026-05-16-phase-3-remote-app-design.md`](../specs/2026-05-16-phase-3-remote-app-design.md) (commit `c078eaa`) for the design contract.

**Tech Stack:** TypeScript (Node 20 + Vite 5), `ws` for WebSockets, `open` for browser launch, existing Vitest test setup, Playwright for E2E.

---

## File Structure

**New files:**

- `daemon/wsTransport.ts` — `WebSocketSink`, `WebSocketBroadcast`, `WebSocketSource` implementations.
- `daemon/wsServer.ts` — WebSocket upgrade handler with Origin + token check.
- `daemon/staticServer.ts` — static-file serving for `webview-ui/dist/`.
- `daemon/agentsPersistence.ts` — atomic read/write for `~/.pixel-agents/agents.json`.
- `daemon/configStore.ts` — file-backed `ConfigStore` interface (replaces `GlobalStateLike`).
- `bin/serve.ts` — CLI entry point with `serve`, `install-hooks`, `uninstall-hooks`, `stop`, `status` subcommands.
- `bin/import-extension-settings.ts` — one-shot migration helper for phase 5.
- `webview-ui/src/wsClient.ts` — browser-side WebSocket client with reconnect + offline queue.
- `daemon/snapshotReplay.ts` — extracted state-replay logic (mirrors today's `sendCurrentAgentStatuses`).
- `daemon/hookScriptInstaller.ts` — writes `~/.pixel-agents/hooks/claude-hook.js` on startup (idempotent + version-checked).
- `__tests__/wsTransport.test.ts`, `__tests__/wsServer.test.ts`, `__tests__/agentsPersistence.test.ts`, `__tests__/snapshotReplay.test.ts`, `__tests__/hookScriptInstaller.test.ts`.

**Modified files:**

- `src/types.ts` — drop `vscode.Terminal` from `AgentState`; widen `MessageSource`'s `Disposable` return type.
- `src/agentManager.ts` — drop `workspaceState` param; remove `vscode.window.createTerminal` path (phase 6).
- `src/layoutPersistence.ts` — drop `workspaceState` legacy-migration branch.
- `src/settingsDefaults.ts` — drop `GlobalStateLike`; take `ConfigStore`.
- `src/assetLoader.ts` — drop `vscode.Uri`-based fallback; resolve via `fileURLToPath(import.meta.url)`.
- `webview-ui/src/vscodeApi.ts` — replace `browserFallback` with real WS transport.
- `webview-ui/src/hooks/useExtensionMessages.ts` → rename to `useDaemonMessages.ts`; consume new transport. Public hook signature unchanged.
- `server/src/server.ts` — accept WS upgrades; serve static files; integrate `wsServer`.
- `package.json` — add `ws` + `open` deps; new `bin` field at cutover (phase 7).
- `webview-ui/src/hooks/useEditorKeyboard.ts`, `webview-ui/src/office/panel/TerminalPane.tsx`, any other Cmd/Ctrl-chord listener — remap to Alt-based shortcuts (phase 6).

**Deleted at cutover (phase 7):**

- `src/extension.ts`, `src/PixelAgentsViewProvider.ts`.
- `acquireVsCodeApi()` declaration + VS Code branch in `vscodeApi.ts`.
- All `contributes.*` and activation events in `package.json`.
- `src/constants.ts` keys for VS Code commands + view IDs.
- `usePtyTerminal` setting (deleted in phase 6, before cutover).

---

## Phase 1 — Module Decoupling

Goal: drop `vscode.*` imports from every module that doesn't need them. After this phase, only `src/extension.ts`, `src/PixelAgentsViewProvider.ts`, and `src/agentManager.ts` (terminal-creation path) still depend on `vscode`. Everything else is `vscode`-free and runs in a regular Node.js process.

### Task 1: Widen `Disposable` to drop `vscode.Disposable` dependency

**Files:**

- Modify: `src/types.ts:29-31` (the `MessageSource` interface)
- Create: `src/disposable.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/disposable.test.ts
import { describe, it, expect } from 'vitest';
import type { Disposable } from '../disposable.js';

describe('Disposable', () => {
  it('matches any { dispose: () => void }', () => {
    const d: Disposable = { dispose: () => {} };
    d.dispose();
    expect(true).toBe(true);
  });

  it('is structurally compatible with vscode.Disposable shape', () => {
    const vscodeShaped = { dispose: () => undefined };
    const d: Disposable = vscodeShaped;
    expect(typeof d.dispose).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/disposable.test.ts`
Expected: FAIL with module-not-found for `../disposable.js`.

- [ ] **Step 3: Create the interface**

```ts
// src/disposable.ts
/** Minimal structural type for an object that can be disposed. Compatible with
 *  vscode.Disposable so existing consumers don't need to change shape; defined
 *  here so daemon-only modules don't import vscode. */
export interface Disposable {
  dispose(): unknown;
}
```

- [ ] **Step 4: Update `MessageSource` to use it**

In `src/types.ts`, change the `MessageSource` interface return type from `vscode.Disposable` to the new `Disposable`:

```ts
import type { Disposable } from './disposable.js';

export interface MessageSource {
  onMessage(handler: (message: Record<string, unknown>) => unknown): Disposable;
}
```

- [ ] **Step 5: Run all tests + build to verify nothing broke**

Run: `npm test && npm run build`
Expected: all tests PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/disposable.ts src/types.ts src/__tests__/disposable.test.ts
git commit -m "phase-3 step 1: widen Disposable interface to drop vscode.Disposable dependency"
```

### Task 2: Drop `vscode` imports from data-only modules

**Files:**

- Modify: `src/transcriptParser.ts`, `src/fileWatcher.ts`, `src/timerManager.ts`, `src/configPersistence.ts`, `src/layoutPersistence.ts`

These modules only used `vscode.Disposable` (or no vscode at all). After Task 1, the import can be removed.

- [ ] **Step 1: Scan for remaining `vscode` imports in data-only modules**

Run: `grep -n "from 'vscode'" src/transcriptParser.ts src/fileWatcher.ts src/timerManager.ts src/configPersistence.ts src/layoutPersistence.ts`
Expected: list of import lines that need removing.

- [ ] **Step 2: For each file, remove the `vscode` import and any `vscode.Disposable` annotations**

Example pattern for each file:

```diff
-import type * as vscode from 'vscode';
+import type { Disposable } from './disposable.js';

-export function startWatching(...): vscode.Disposable {
+export function startWatching(...): Disposable {
```

If a file uses `vscode.Uri` or `vscode.workspace.fs` for a fallback path, leave those for Task 3 (`assetLoader.ts`) or Task 4 (`layoutPersistence.ts`'s `workspaceState` branch). This task is _only_ about `vscode.Disposable` replacements + bare imports.

- [ ] **Step 3: Run build + existing tests**

Run: `npm test && npm run build`
Expected: all tests PASS, build clean. No regressions in the extension's behavior because the new `Disposable` is structurally identical.

- [ ] **Step 4: Commit**

```bash
git add src/transcriptParser.ts src/fileWatcher.ts src/timerManager.ts src/configPersistence.ts src/layoutPersistence.ts
git commit -m "phase-3 step 1: drop vscode imports from data-only modules"
```

### Task 3: Drop `vscode.Uri` fallback in `assetLoader.ts`

**Files:**

- Modify: `src/assetLoader.ts`

The existing fallback path uses `vscode.workspace.fs.readFile()` with `vscode.Uri.joinPath()`. Replace with Node's `fs.promises.readFile` + `fileURLToPath(import.meta.url)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/assetLoader.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBundledAssetPath } from '../assetLoader.js';

describe('resolveBundledAssetPath', () => {
  it('resolves relative to the running module, not vscode workspace', () => {
    const p = resolveBundledAssetPath('floors.png');
    expect(p).toMatch(/[/\\]assets[/\\]floors\.png$/);
    expect(p).not.toMatch(/vscode/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/assetLoader.test.ts`
Expected: FAIL — `resolveBundledAssetPath` not exported.

- [ ] **Step 3: Implement the resolver**

In `src/assetLoader.ts`, add at the top of the file:

```ts
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

/** Resolve a bundled asset by name. Bundled assets live next to the daemon's
 *  built JS in `dist/assets/`. During tests we resolve against the source tree's
 *  `webview-ui/public/assets/` via the same import.meta.url base. */
export function resolveBundledAssetPath(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'assets', name);
}
```

Then replace any existing `vscode.workspace.fs.readFile(vscode.Uri.joinPath(...))` calls with `fs.promises.readFile(resolveBundledAssetPath(name))`. Keep the existing workspace-root fallback for files the extension scans (those still come through `vscode` because they're user-provided paths). The _bundled_ asset path is the only one that loses the vscode.Uri.

- [ ] **Step 4: Run all tests**

Run: `npm test && npm run build`
Expected: PASS. Extension still works — bundled assets load via the new resolver, which works fine in the extension host process (`__dirname` resolves under `dist/`).

- [ ] **Step 5: Commit**

```bash
git add src/assetLoader.ts src/__tests__/assetLoader.test.ts
git commit -m "phase-3 step 1: drop vscode.Uri fallback for bundled assets; resolve via import.meta.url"
```

---

## Phase 2 — WebSocket Transport

Goal: add `ws` to the daemon; wire `WebSocketSink`, `WebSocketBroadcast`, `WebSocketSource`; build the browser-side transport adapter; implement snapshot-on-open replay. After this phase, the SPA tab can connect to `PixelAgentsServer` and receive the same broadcasts the VS Code webview does.

### Task 4: Add `ws` + `open` dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install `ws` and `open`**

```bash
npm install ws@^8 open@^10
npm install --save-dev @types/ws@^8
```

- [ ] **Step 2: Verify they appear in `package.json` `dependencies` and `devDependencies`**

Run: `grep -E '"(ws|open|@types/ws)"' package.json`
Expected: three lines, two in `dependencies` (`ws`, `open`), one in `devDependencies` (`@types/ws`).

- [ ] **Step 3: Run build + tests to confirm nothing broke**

Run: `npm test && npm run build`
Expected: PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "phase-3 step 2: add ws + open dependencies"
```

### Task 5: Build `WebSocketSink`, `WebSocketBroadcast`, `WebSocketSource`

**Files:**

- Create: `daemon/wsTransport.ts`, `daemon/__tests__/wsTransport.test.ts`

The new `daemon/` directory mirrors the planned post-cutover layout. During phases 2–6 it sits alongside `src/` and `server/`; at cutover those collapse into it.

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/wsTransport.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocketSink, WebSocketBroadcast, WebSocketSource } from '../wsTransport.js';

function fakeWs(state: 'OPEN' | 'CLOSED' = 'OPEN') {
  const send = vi.fn();
  const onCb: Record<string, (data: unknown) => void> = {};
  return {
    readyState: state === 'OPEN' ? 1 : 3,
    OPEN: 1,
    send,
    on: (evt: string, cb: (d: unknown) => void) => {
      onCb[evt] = cb;
    },
    off: vi.fn(),
    _emit: (evt: string, d: unknown) => onCb[evt]?.(d),
  } as unknown as WebSocket & { _emit: (e: string, d: unknown) => void };
}

describe('WebSocketSink', () => {
  it('JSON-stringifies and writes to the underlying socket', async () => {
    const ws = fakeWs('OPEN');
    const sink = new WebSocketSink(ws);
    await sink.postMessage({ type: 'hello', n: 1 });
    expect(ws.send as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('{"type":"hello","n":1}');
  });
});

describe('WebSocketBroadcast', () => {
  it('fans messages to every OPEN client, skips CLOSED ones', async () => {
    const open1 = fakeWs('OPEN');
    const open2 = fakeWs('OPEN');
    const closed = fakeWs('CLOSED');
    const clients = new Set([open1, open2, closed]);
    const bcast = new WebSocketBroadcast(clients);
    await bcast.postMessage({ type: 'ping' });
    expect(open1.send as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(open2.send as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(closed.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe('WebSocketSource', () => {
  it('parses inbound JSON and invokes the handler', () => {
    const ws = fakeWs('OPEN');
    const src = new WebSocketSource(ws);
    const handler = vi.fn();
    src.onMessage(handler);
    ws._emit('message', Buffer.from('{"type":"clicked","id":7}'));
    expect(handler).toHaveBeenCalledWith({ type: 'clicked', id: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/wsTransport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/wsTransport.ts
import type { WebSocket } from 'ws';
import type { MessageSink, MessageSource } from '../src/types.js';
import type { Disposable } from '../src/disposable.js';

export class WebSocketSink implements MessageSink {
  constructor(private ws: WebSocket) {}
  postMessage(msg: unknown): Promise<boolean> {
    this.ws.send(JSON.stringify(msg));
    return Promise.resolve(true);
  }
}

export class WebSocketBroadcast implements MessageSink {
  constructor(private clients: Set<WebSocket>) {}
  postMessage(msg: unknown): Promise<boolean> {
    const s = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.readyState === c.OPEN) c.send(s);
    }
    return Promise.resolve(true);
  }
}

export class WebSocketSource implements MessageSource {
  constructor(private ws: WebSocket) {}
  onMessage(handler: (m: Record<string, unknown>) => unknown): Disposable {
    const fn = (data: Buffer) => {
      try {
        handler(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        // malformed frame; drop
      }
    };
    this.ws.on('message', fn);
    return { dispose: () => this.ws.off('message', fn) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run daemon/__tests__/wsTransport.test.ts`
Expected: PASS, three tests green.

- [ ] **Step 5: Commit**

```bash
git add daemon/wsTransport.ts daemon/__tests__/wsTransport.test.ts
git commit -m "phase-3 step 2: WebSocketSink, WebSocketBroadcast, WebSocketSource"
```

### Task 6: Wire WS upgrade handler into `PixelAgentsServer`

**Files:**

- Modify: `server/src/server.ts`
- Create: `daemon/wsServer.ts`, `daemon/__tests__/wsServer.test.ts`

- [ ] **Step 1: Write the failing test for the upgrade handler**

```ts
// daemon/__tests__/wsServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as http from 'node:http';
import { acceptUpgrade, type UpgradeContext } from '../wsServer.js';

const TOKEN = 'tok-123';

function fakeReq(headers: Record<string, string>, url = '/ws?token=tok-123'): http.IncomingMessage {
  return { headers, url } as unknown as http.IncomingMessage;
}

describe('acceptUpgrade', () => {
  const ctx: UpgradeContext = { allowedOrigins: ['http://127.0.0.1:39187'], token: TOKEN };
  it('accepts requests with matching origin and token', () => {
    const ok = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }), ctx);
    expect(ok).toEqual({ kind: 'accept' });
  });
  it('rejects on wrong origin', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://evil.example' }), ctx);
    expect(res).toEqual({ kind: 'reject', code: 403, reason: 'origin' });
  });
  it('rejects on missing token', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }, '/ws'), ctx);
    expect(res).toEqual({ kind: 'reject', code: 401, reason: 'token' });
  });
  it('rejects on wrong token', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }, '/ws?token=nope'), ctx);
    expect(res).toEqual({ kind: 'reject', code: 401, reason: 'token' });
  });
  it('also accepts http://localhost:<port>', () => {
    const c2 = {
      allowedOrigins: ['http://127.0.0.1:39187', 'http://localhost:39187'],
      token: TOKEN,
    };
    const ok = acceptUpgrade(fakeReq({ origin: 'http://localhost:39187' }), c2);
    expect(ok).toEqual({ kind: 'accept' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/wsServer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `acceptUpgrade`**

```ts
// daemon/wsServer.ts
import type * as http from 'node:http';

export interface UpgradeContext {
  allowedOrigins: string[];
  token: string;
}

export type UpgradeDecision =
  | { kind: 'accept' }
  | { kind: 'reject'; code: 401 | 403; reason: 'origin' | 'token' };

export function acceptUpgrade(req: http.IncomingMessage, ctx: UpgradeContext): UpgradeDecision {
  const origin = req.headers.origin ?? '';
  if (!ctx.allowedOrigins.includes(origin)) {
    return { kind: 'reject', code: 403, reason: 'origin' };
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const token = url.searchParams.get('token') ?? '';
  if (token !== ctx.token) {
    return { kind: 'reject', code: 401, reason: 'token' };
  }
  return { kind: 'accept' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run daemon/__tests__/wsServer.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Wire the WS server into `PixelAgentsServer`**

In `server/src/server.ts`, add:

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import { acceptUpgrade } from '../../daemon/wsServer.js';
import { WebSocketBroadcast, WebSocketSource } from '../../daemon/wsTransport.js';

// inside PixelAgentsServer:
private wss: WebSocketServer | null = null;
private wsClients = new Set<WebSocket>();
private wsBroadcast = new WebSocketBroadcast(this.wsClients);
private wsConnectHandler: ((src: WebSocketSource, sink: WebSocketBroadcast) => void) | null = null;

onWebSocketConnect(cb: (src: WebSocketSource, sink: WebSocketBroadcast) => void) {
  this.wsConnectHandler = cb;
}

getBroadcastSink(): WebSocketBroadcast {
  return this.wsBroadcast;
}
```

In the `start()` method, after `this.server.listen(...)`:

```ts
this.wss = new WebSocketServer({ noServer: true });
this.server.on('upgrade', (req, sock, head) => {
  const port = (this.config as ServerConfig).port;
  const decision = acceptUpgrade(req, {
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    token: this.config!.token,
  });
  if (decision.kind === 'reject') {
    sock.write(`HTTP/1.1 ${decision.code} ${decision.reason}\r\n\r\n`);
    sock.destroy();
    return;
  }
  this.wss!.handleUpgrade(req, sock, head, (ws) => {
    this.wsClients.add(ws);
    ws.on('close', () => this.wsClients.delete(ws));
    this.wsConnectHandler?.(new WebSocketSource(ws), this.wsBroadcast);
  });
});
```

- [ ] **Step 6: Add an integration test for the upgrade flow**

```ts
// daemon/__tests__/wsServer.integration.test.ts
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { PixelAgentsServer } from '../../server/src/server.js';

describe('PixelAgentsServer WebSocket', () => {
  it('accepts a connection from an allowed origin with the correct token', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
        origin: `http://127.0.0.1:${cfg.port}`,
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 1000);
      });
      ws.close();
    } finally {
      server.stop();
    }
  });
  it('rejects on bad origin', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
        origin: 'http://evil.example',
      });
      const err = await new Promise<Error>((resolve) => ws.on('error', resolve));
      expect(err.message).toMatch(/403|unexpected response/i);
    } finally {
      server.stop();
    }
  });
});
```

- [ ] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/server.ts daemon/wsServer.ts daemon/__tests__/wsServer.test.ts daemon/__tests__/wsServer.integration.test.ts
git commit -m "phase-3 step 2: PixelAgentsServer accepts WebSocket upgrades with Origin + token check"
```

### Task 7: Snapshot-on-open replay

**Files:**

- Create: `daemon/snapshotReplay.ts`, `daemon/__tests__/snapshotReplay.test.ts`
- Modify: `src/PixelAgentsViewProvider.ts` (extract existing `sendCurrentAgentStatuses` shape)

- [ ] **Step 1: Identify what gets replayed on `webviewReady` today**

Run: `grep -n "sendCurrentAgentStatuses\|webviewReady" src/PixelAgentsViewProvider.ts src/agentManager.ts | head -20`
Note the exact message types that fire when a new webview connects today. Per the spec these are: `existingAgents`, `layoutLoaded`, `settingsLoaded`, `hookHealthChanged`, plus per-agent replays of `agentRenamed` and `agentTeamInfo`.

- [ ] **Step 2: Write the failing test**

```ts
// daemon/__tests__/snapshotReplay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { replaySnapshot, type SnapshotDeps } from '../snapshotReplay.js';

describe('replaySnapshot', () => {
  it('sends existingAgents, layoutLoaded, settingsLoaded, hookHealthChanged in order', async () => {
    const sink = { postMessage: vi.fn().mockResolvedValue(true) };
    const deps: SnapshotDeps = {
      sink,
      getExistingAgents: () => [{ id: 1, sessionId: 'a' }],
      getLayout: () => ({ version: 1, cols: 20, rows: 11, tiles: [], furniture: [] }),
      getSettings: () => ({ soundEnabled: true }),
      getHookHealth: () => 'ok',
      getRenamedAgents: () => [],
      getTeamInfo: () => [],
    };
    await replaySnapshot(deps);
    const calls = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].type);
    expect(calls).toEqual([
      'existingAgents',
      'layoutLoaded',
      'settingsLoaded',
      'hookHealthChanged',
    ]);
  });

  it('emits agentRenamed for each renamed agent after settingsLoaded', async () => {
    const sink = { postMessage: vi.fn().mockResolvedValue(true) };
    const deps: SnapshotDeps = {
      sink,
      getExistingAgents: () => [],
      getLayout: () => null,
      getSettings: () => ({}),
      getHookHealth: () => null,
      getRenamedAgents: () => [
        { id: 1, customTitle: 'Lead' },
        { id: 2, customTitle: 'Helper' },
      ],
      getTeamInfo: () => [],
    };
    await replaySnapshot(deps);
    const calls = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.type === 'agentRenamed')).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/snapshotReplay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// daemon/snapshotReplay.ts
import type { MessageSink } from '../src/types.js';

export interface SnapshotDeps {
  sink: MessageSink;
  getExistingAgents: () => Array<{ id: number; sessionId?: string; [k: string]: unknown }>;
  getLayout: () => Record<string, unknown> | null;
  getSettings: () => Record<string, unknown>;
  getHookHealth: () => string | null;
  getRenamedAgents: () => Array<{ id: number; customTitle: string }>;
  getTeamInfo: () => Array<{
    id: number;
    teamName?: string;
    agentName?: string;
    isTeamLead?: boolean;
    leadAgentId?: number;
  }>;
}

/** Fire the full snapshot to a sink. Idempotent — safe to call on every WS
 *  connect or reconnect. Order: existingAgents -> layoutLoaded -> settingsLoaded
 *  -> hookHealthChanged -> per-agent agentRenamed + agentTeamInfo. */
export async function replaySnapshot(deps: SnapshotDeps): Promise<void> {
  await deps.sink.postMessage({ type: 'existingAgents', agents: deps.getExistingAgents() });
  const layout = deps.getLayout();
  if (layout) {
    await deps.sink.postMessage({ type: 'layoutLoaded', layout });
  }
  await deps.sink.postMessage({ type: 'settingsLoaded', settings: deps.getSettings() });
  const health = deps.getHookHealth();
  if (health) {
    await deps.sink.postMessage({ type: 'hookHealthChanged', state: health });
  }
  for (const a of deps.getRenamedAgents()) {
    await deps.sink.postMessage({ type: 'agentRenamed', id: a.id, customTitle: a.customTitle });
  }
  for (const t of deps.getTeamInfo()) {
    await deps.sink.postMessage({ type: 'agentTeamInfo', ...t });
  }
}
```

- [ ] **Step 5: Wire `replaySnapshot` into the WS upgrade callback**

In `server/src/server.ts`'s `onWebSocketConnect` handler (registered by the provider during phases 2–6, by `bin/serve.ts` after cutover):

```ts
server.onWebSocketConnect((src, sink) => {
  // build deps from the same providers used by sendCurrentAgentStatuses today
  replaySnapshot({
    sink: new WebSocketSink(/* this client */),
    getExistingAgents: () => agentManager.getAgentSummaries(),
    getLayout: () => layoutPersistence.read(),
    getSettings: () => settingsStore.snapshot(),
    getHookHealth: () => server.getHealthState(),
    getRenamedAgents: () => agentManager.getRenamedAgents(),
    getTeamInfo: () => agentManager.getTeamInfo(),
  });
});
```

Note: the SINK in the snapshot must be the **per-connection** `WebSocketSink`, not the broadcast — otherwise we'd repaint every connected client whenever any new tab opens. The broadcast sink continues to receive ongoing state-change events as normal.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add daemon/snapshotReplay.ts daemon/__tests__/snapshotReplay.test.ts server/src/server.ts
git commit -m "phase-3 step 2: snapshot-on-open replay (existing/layout/settings/health + per-agent rename/team)"
```

### Task 8: Browser-side WS transport (`vscodeApi.ts` rewrite)

**Files:**

- Modify: `webview-ui/src/vscodeApi.ts`
- Create: `webview-ui/src/wsClient.ts`, `webview-ui/src/__tests__/wsClient.test.ts`

- [ ] **Step 1: Write the failing test for the offline queue + reconnect**

```ts
// webview-ui/src/__tests__/wsClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWsClient } from '../wsClient.js';

class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS;
});

describe('createWsClient', () => {
  it('queues messages before open and flushes on open', () => {
    const client = createWsClient({ url: 'ws://localhost/ws', onMessage: vi.fn() });
    client.postMessage({ type: 'hello' });
    expect(FakeWS.last!.sent).toEqual([]);
    FakeWS.last!.open();
    expect(FakeWS.last!.sent).toEqual(['{"type":"hello"}']);
  });

  it('dispatches inbound JSON to onMessage', () => {
    const onMessage = vi.fn();
    createWsClient({ url: 'ws://localhost/ws', onMessage });
    FakeWS.last!.open();
    FakeWS.last!.receive({ type: 'agentCreated', id: 1 });
    expect(onMessage).toHaveBeenCalledWith({ type: 'agentCreated', id: 1 });
  });

  it('reconnects after close (queue persists across reconnect)', async () => {
    const client = createWsClient({ url: 'ws://localhost/ws', onMessage: vi.fn(), reconnectMs: 0 });
    FakeWS.last!.open();
    FakeWS.last!.close();
    client.postMessage({ type: 'queued-while-down' });
    await new Promise((r) => setTimeout(r, 5));
    expect(FakeWS.last!.url).toBe('ws://localhost/ws');
    FakeWS.last!.open();
    expect(FakeWS.last!.sent).toEqual(['{"type":"queued-while-down"}']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webview-ui && npm test -- --run src/__tests__/wsClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wsClient.ts`**

```ts
// webview-ui/src/wsClient.ts
export interface WsClient {
  postMessage(msg: unknown): void;
}

export interface WsClientOptions {
  url: string;
  onMessage: (msg: unknown) => void;
  reconnectMs?: number;
}

export function createWsClient(opts: WsClientOptions): WsClient {
  const queue: string[] = [];
  let ws: WebSocket | null = null;

  const connect = () => {
    ws = new WebSocket(opts.url);
    ws.onopen = () => {
      while (queue.length) ws!.send(queue.shift()!);
    };
    ws.onmessage = (e) => {
      try {
        opts.onMessage(JSON.parse(typeof e.data === 'string' ? e.data : ''));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      setTimeout(connect, opts.reconnectMs ?? 500);
    };
  };

  connect();

  return {
    postMessage(msg: unknown) {
      const s = JSON.stringify(msg);
      if (ws && ws.readyState === ws.OPEN) ws.send(s);
      else queue.push(s);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webview-ui && npm test -- --run src/__tests__/wsClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `vscodeApi.ts`'s browser branch to use it**

```ts
// webview-ui/src/vscodeApi.ts
import { isBrowserRuntime } from './runtime';
import { createWsClient } from './wsClient';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
};

export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
}

function buildBrowserApi(): VSCodeApi {
  const wsUrl = `ws://${location.host}/ws?token=${encodeURIComponent(
    document.querySelector<HTMLMetaElement>('meta[name="px-token"]')?.content ?? '',
  )}`;
  const client = createWsClient({
    url: wsUrl,
    onMessage: (msg) => {
      window.dispatchEvent(new MessageEvent('message', { data: msg }));
    },
  });
  return {
    postMessage: (msg) => client.postMessage(msg),
    getState: <T>() =>
      localStorage.getItem('px-state')
        ? (JSON.parse(localStorage.getItem('px-state')!) as T)
        : undefined,
    setState: <T>(state: T) => {
      localStorage.setItem('px-state', JSON.stringify(state));
      return state;
    },
  };
}

export const vscode: VSCodeApi = isBrowserRuntime
  ? buildBrowserApi()
  : (acquireVsCodeApi() as VSCodeApi);
```

- [ ] **Step 6: Verify the existing webview tests still pass**

Run: `cd webview-ui && npm test`
Expected: all PASS (the browser branch is only exercised when `isBrowserRuntime`; existing tests run as VS Code branch via mocks).

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/wsClient.ts webview-ui/src/vscodeApi.ts webview-ui/src/__tests__/wsClient.test.ts
git commit -m "phase-3 step 2: real WS transport in vscodeApi.ts browser branch (reconnect + offline-queue)"
```

---

## Phase 3 — Static SPA Serving

Goal: the daemon serves `webview-ui/dist/` from `/`. After this phase, opening `http://127.0.0.1:<port>` in a browser loads the SPA, which connects via WS and renders the office.

### Task 9: Build the static-file middleware

**Files:**

- Create: `daemon/staticServer.ts`, `daemon/__tests__/staticServer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/staticServer.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { serveStaticFile } from '../staticServer.js';

describe('serveStaticFile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-static-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>px</title>');
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.writeFileSync(path.join(tmp, 'assets', 'app.js'), 'console.log(1)');

  it('serves index.html for /', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/' });
    expect(result?.contentType).toBe('text/html');
    expect(String(result?.body)).toContain('<!doctype html>');
  });
  it('serves assets/app.js with application/javascript', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/assets/app.js' });
    expect(result?.contentType).toBe('application/javascript');
  });
  it('returns null for missing files (caller falls through to 404)', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/nope.txt' });
    expect(result).toBeNull();
  });
  it('rejects path traversal attempts', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/../../../etc/passwd' });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/staticServer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/staticServer.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface StaticResult {
  body: Buffer;
  contentType: string;
}

export function serveStaticFile(opts: { root: string; urlPath: string }): StaticResult | null {
  const cleanUrl = opts.urlPath.split('?')[0];
  const target = cleanUrl === '/' ? '/index.html' : cleanUrl;
  const filePath = path.normalize(path.join(opts.root, target));
  if (
    !filePath.startsWith(path.resolve(opts.root) + path.sep) &&
    filePath !== path.resolve(opts.root) + '/index.html'
  ) {
    return null;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  return { body: fs.readFileSync(filePath), contentType: MIME[ext] ?? 'application/octet-stream' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run daemon/__tests__/staticServer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire into `PixelAgentsServer.handleRequest`**

In `server/src/server.ts`'s `handleRequest`, before the 404:

```ts
import { serveStaticFile } from '../../daemon/staticServer.js';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const SPA_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'webview-ui',
  'dist',
);

// in handleRequest, after the /api routes:
if (req.method === 'GET') {
  const result = serveStaticFile({ root: SPA_ROOT, urlPath: url });
  if (result) {
    // Inject the token into index.html so the SPA can include it in the WS URL
    let body: Buffer = result.body;
    if (result.contentType === 'text/html' && this.config) {
      const html = body
        .toString()
        .replace(/<head>/i, `<head><meta name="px-token" content="${this.config.token}">`);
      body = Buffer.from(html);
    }
    res.writeHead(200, { 'Content-Type': result.contentType });
    res.end(body);
    return;
  }
}
```

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run: F5 in VS Code (Extension Dev Host). With the extension running, open `http://127.0.0.1:<port>` (port from `~/.pixel-agents/server.json`) in Chrome. Expected: SPA loads; agents appear in the office canvas; WebSocket connects (DevTools → Network → WS).

- [ ] **Step 8: Commit**

```bash
git add daemon/staticServer.ts daemon/__tests__/staticServer.test.ts server/src/server.ts
git commit -m "phase-3 step 3: PixelAgentsServer serves webview-ui/dist/ at /; injects px-token meta for WS auth"
```

---

## Phase 4 — CLI Entry Point

Goal: `pixel-agents serve` becomes a real command. Standalone process starts the daemon, opens a browser tab. After this phase, the user can run the daemon without opening VS Code, though VS Code still has its own copy of the same modules.

### Task 10: `bin/serve.ts` skeleton + `serve` subcommand

**Files:**

- Create: `bin/serve.ts`, `bin/__tests__/serve.test.ts`
- Modify: `package.json` (`bin` field — leave commented out for now, comes alive at cutover)

- [ ] **Step 1: Write a smoke test that boots the daemon and exits cleanly**

```ts
// bin/__tests__/serve.test.ts
import { describe, it, expect } from 'vitest';
import { startDaemon } from '../serve.js';

describe('startDaemon', () => {
  it('starts on an ephemeral port, exposes config, and stops cleanly', async () => {
    const { server, stop } = await startDaemon({ open: false });
    const cfg = server.getConfig();
    expect(cfg?.port).toBeGreaterThan(0);
    expect(cfg?.token).toMatch(/^[a-f0-9-]+$/);
    await stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run bin/__tests__/serve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startDaemon` + `serve` CLI dispatch**

```ts
// bin/serve.ts
import { PixelAgentsServer } from '../server/src/server.js';

export async function startDaemon(opts: { open?: boolean } = {}): Promise<{
  server: PixelAgentsServer;
  stop: () => Promise<void>;
}> {
  const server = new PixelAgentsServer();
  const cfg = await server.start();
  if (opts.open ?? true) {
    const { default: open } = await import('open');
    await open(`http://127.0.0.1:${cfg.port}`);
  }
  console.log(`[Pixel Agents] daemon listening on http://127.0.0.1:${cfg.port}`);
  return {
    server,
    stop: async () => {
      server.stop();
    },
  };
}

async function main() {
  const cmd = process.argv[2] ?? 'serve';
  switch (cmd) {
    case 'serve': {
      const noOpen = process.argv.includes('--no-open');
      const { stop } = await startDaemon({ open: !noOpen });
      process.on('SIGINT', () => {
        stop().then(() => process.exit(0));
      });
      process.on('SIGTERM', () => {
        stop().then(() => process.exit(0));
      });
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run bin/__tests__/serve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/serve.ts bin/__tests__/serve.test.ts
git commit -m "phase-3 step 4: bin/serve.ts startDaemon + serve subcommand"
```

### Task 11: `install-hooks` + `uninstall-hooks` + `stop` + `status` subcommands

**Files:**

- Modify: `bin/serve.ts`
- Create: `bin/__tests__/subcommands.test.ts`

- [ ] **Step 1: Write tests for each subcommand**

```ts
// bin/__tests__/subcommands.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runInstallHooks, runUninstallHooks, runStop, runStatus } from '../serve.js';

describe('install-hooks', () => {
  it('delegates to claudeHookInstaller and returns exit code 0', async () => {
    const installer = { install: vi.fn().mockResolvedValue(undefined) };
    const code = await runInstallHooks({ installer });
    expect(installer.install).toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

describe('uninstall-hooks', () => {
  it('delegates to claudeHookInstaller.uninstall and returns 0', async () => {
    const installer = { uninstall: vi.fn().mockResolvedValue(undefined) };
    const code = await runUninstallHooks({ installer });
    expect(installer.uninstall).toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

describe('status', () => {
  it('reads server.json and prints port + PID; exits 0 when alive', async () => {
    const log = vi.fn();
    const code = await runStatus({
      readServerJson: () => ({ port: 12345, pid: 99999, token: 't', startedAt: 0 }),
      pidAlive: () => true,
      log,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('12345'));
    expect(code).toBe(0);
  });
  it('exits 1 when not running', async () => {
    const code = await runStatus({
      readServerJson: () => null,
      pidAlive: () => false,
      log: vi.fn(),
    });
    expect(code).toBe(1);
  });
});

describe('stop', () => {
  it('sends SIGTERM to the PID from server.json and exits 0', async () => {
    const kill = vi.fn();
    const code = await runStop({
      readServerJson: () => ({ port: 12345, pid: 99999, token: 't', startedAt: 0 }),
      kill,
    });
    expect(kill).toHaveBeenCalledWith(99999, 'SIGTERM');
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run bin/__tests__/subcommands.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement the subcommands**

```ts
// bin/serve.ts (additions)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface HookInstaller {
  install?: () => Promise<void>;
  uninstall?: () => Promise<void>;
}

export async function runInstallHooks(deps: { installer: HookInstaller }): Promise<number> {
  await deps.installer.install?.();
  console.log('[Pixel Agents] hooks installed');
  return 0;
}

export async function runUninstallHooks(deps: { installer: HookInstaller }): Promise<number> {
  await deps.installer.uninstall?.();
  console.log('[Pixel Agents] hooks uninstalled');
  return 0;
}

interface ServerJson {
  port: number;
  pid: number;
  token: string;
  startedAt: number;
}

export async function runStatus(deps: {
  readServerJson: () => ServerJson | null;
  pidAlive: (pid: number) => boolean;
  log: (s: string) => void;
}): Promise<number> {
  const j = deps.readServerJson();
  if (!j || !deps.pidAlive(j.pid)) {
    deps.log('not running');
    return 1;
  }
  deps.log(`running on http://127.0.0.1:${j.port} (pid ${j.pid})`);
  return 0;
}

export async function runStop(deps: {
  readServerJson: () => ServerJson | null;
  kill: (pid: number, signal: 'SIGTERM') => void;
}): Promise<number> {
  const j = deps.readServerJson();
  if (!j) {
    console.error('not running');
    return 1;
  }
  deps.kill(j.pid, 'SIGTERM');
  return 0;
}

function defaultReadServerJson(): ServerJson | null {
  const p = path.join(os.homedir(), '.pixel-agents', 'server.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ServerJson;
  } catch {
    return null;
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

Wire into `main()` dispatch:

```ts
case 'install-hooks':
  process.exit(await runInstallHooks({ installer: await loadInstaller() }));
case 'uninstall-hooks':
  process.exit(await runUninstallHooks({ installer: await loadInstaller() }));
case 'status':
  process.exit(await runStatus({ readServerJson: defaultReadServerJson, pidAlive: defaultPidAlive, log: console.log }));
case 'stop':
  process.exit(await runStop({ readServerJson: defaultReadServerJson, kill: process.kill.bind(process) }));
```

`loadInstaller()` dynamically imports the existing `claudeHookInstaller` so the CLI doesn't pay its cost at startup:

```ts
async function loadInstaller(): Promise<HookInstaller> {
  const mod = await import('../server/src/providers/hook/claude/claudeHookInstaller.js');
  return { install: mod.installHooks, uninstall: mod.uninstallHooks };
}
```

(Use whatever names the actual `claudeHookInstaller.ts` exports — read it first.)

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/serve.ts bin/__tests__/subcommands.test.ts
git commit -m "phase-3 step 4: install-hooks/uninstall-hooks/stop/status subcommands"
```

### Task 12: Hook script ownership transition

**Files:**

- Create: `daemon/hookScriptInstaller.ts`, `daemon/__tests__/hookScriptInstaller.test.ts`
- Modify: `bin/serve.ts` (call on `serve` startup)

The extension currently writes `~/.pixel-agents/hooks/claude-hook.js` at activation. After this task, the daemon writes it on `serve` startup (idempotent, version-checked).

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/hookScriptInstaller.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureHookScript, HOOK_SCRIPT_VERSION } from '../hookScriptInstaller.js';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'px-hook-'));
const bundled = path.join(tmpHome, 'bundled-claude-hook.js');
const dest = path.join(tmpHome, '.pixel-agents', 'hooks', 'claude-hook.js');

beforeEach(() => {
  fs.writeFileSync(bundled, `// version: ${HOOK_SCRIPT_VERSION}\nconsole.log('hi');`);
  try {
    fs.rmSync(path.dirname(dest), { recursive: true });
  } catch {
    /* */
  }
});

describe('ensureHookScript', () => {
  it('writes the script when missing', () => {
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('overwrites when version mismatched', () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, '// version: 0\nold content');
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.readFileSync(dest, 'utf-8')).toContain(`version: ${HOOK_SCRIPT_VERSION}`);
  });

  it('leaves the script alone when versions match', () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `// version: ${HOOK_SCRIPT_VERSION}\nuser-edited content`);
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.readFileSync(dest, 'utf-8')).toContain('user-edited content');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/hookScriptInstaller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/hookScriptInstaller.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export const HOOK_SCRIPT_VERSION = '3';

export function ensureHookScript(opts: { home: string; bundledPath: string }): void {
  const destDir = path.join(opts.home, '.pixel-agents', 'hooks');
  const destFile = path.join(destDir, 'claude-hook.js');
  fs.mkdirSync(destDir, { recursive: true });
  const bundled = fs.readFileSync(opts.bundledPath, 'utf-8');
  const want = `version: ${HOOK_SCRIPT_VERSION}`;
  if (fs.existsSync(destFile)) {
    const existing = fs.readFileSync(destFile, 'utf-8');
    if (existing.includes(want)) return;
  }
  fs.writeFileSync(destFile, bundled, { mode: 0o755 });
}
```

- [ ] **Step 4: Wire into `startDaemon`**

In `bin/serve.ts`:

```ts
import { ensureHookScript } from '../daemon/hookScriptInstaller.js';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as os from 'node:os';

export async function startDaemon(opts: { open?: boolean } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, '..', 'dist', 'hooks', 'claude-hook.js');
  ensureHookScript({ home: os.homedir(), bundledPath: bundled });
  // ... rest of existing startDaemon
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add daemon/hookScriptInstaller.ts daemon/__tests__/hookScriptInstaller.test.ts bin/serve.ts
git commit -m "phase-3 step 4: daemon writes ~/.pixel-agents/hooks/claude-hook.js on serve startup"
```

---

## Phase 5 — File-Based Persistence

Goal: `agents.json` becomes the persistence backend; settings keys move from `globalState` to `config.json`; a one-shot helper backfills from globalState. After this phase, the extension and the daemon read/write the same `config.json`.

### Task 13: `agentsPersistence.ts` with atomic write

**Files:**

- Create: `daemon/agentsPersistence.ts`, `daemon/__tests__/agentsPersistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/agentsPersistence.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readAgents, writeAgents, type AgentsFile } from '../agentsPersistence.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-agents-'));
const file = path.join(tmp, 'agents.json');

describe('agentsPersistence', () => {
  it('returns a fresh empty file when none exists', () => {
    const f = readAgents(file);
    expect(f).toEqual({ version: 1, nextAgentId: 1, nextTerminalIndex: 1, agents: [] });
  });

  it('writes atomically via tmp + rename', () => {
    const f: AgentsFile = {
      version: 1,
      nextAgentId: 2,
      nextTerminalIndex: 5,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a.jsonl',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
        },
      ],
    };
    writeAgents(file, f);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    expect(readAgents(file)).toEqual(f);
  });

  it('rejects unknown version', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 99, agents: [] }));
    expect(() => readAgents(file)).toThrow(/version/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/agentsPersistence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/agentsPersistence.ts
import * as fs from 'node:fs';

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  terminalName: string;
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  workSeatId?: string;
  palette: number;
  hueShift: number;
  customTitle?: string;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentsFile {
  version: 1;
  nextAgentId: number;
  nextTerminalIndex: number;
  agents: PersistedAgent[];
}

const EMPTY: AgentsFile = { version: 1, nextAgentId: 1, nextTerminalIndex: 1, agents: [] };

export function readAgents(file: string): AgentsFile {
  if (!fs.existsSync(file)) return { ...EMPTY };
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentsFile;
  if (data.version !== 1) throw new Error(`agents.json: unsupported version ${data.version}`);
  return data;
}

export function writeAgents(file: string, data: AgentsFile): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run daemon/__tests__/agentsPersistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/agentsPersistence.ts daemon/__tests__/agentsPersistence.test.ts
git commit -m "phase-3 step 5: agentsPersistence read/write with atomic tmp+rename"
```

### Task 14: Migrate `agentManager` to read/write `agents.json`

**Files:**

- Modify: `src/agentManager.ts`, `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Identify the current `workspaceState`-backed persistence points**

Run: `grep -n "workspaceState\." src/agentManager.ts src/PixelAgentsViewProvider.ts`
Note each call site. There should be one read (`restoreAgents`) and one write (after every state mutation, in `persistAgents`).

- [ ] **Step 2: Replace the read site**

In `restoreAgents`, the parameter currently typed as `vscode.Memento` (or similar) becomes a `() => AgentsFile`:

```ts
// before
export function restoreAgents(workspaceState: vscode.Memento, ...) {
  const persisted = workspaceState.get<PersistedAgent[]>('pixel-agents.agents') ?? [];
  // ...
}

// after
import { readAgents } from '../daemon/agentsPersistence.js';
export function restoreAgents(readAgentsFile: () => AgentsFile, ...) {
  const file = readAgentsFile();
  const persisted = file.agents;
  // ...
}
```

- [ ] **Step 3: Replace the write site**

```ts
// before
workspaceState.update('pixel-agents.agents', toPersist);

// after
import { writeAgents } from '../daemon/agentsPersistence.js';
writeAgents(agentsFilePath, { version: 1, nextAgentId, nextTerminalIndex, agents: toPersist });
```

- [ ] **Step 4: Update `PixelAgentsViewProvider.ts` to pass the new callbacks**

The provider wires `agentManager` with `() => readAgents(agentsFilePath)` and a writer that calls `writeAgents`. Path: `path.join(os.homedir(), '.pixel-agents', 'agents.json')`.

- [ ] **Step 5: Drop fields not in the new schema**

`folderName` is no longer persisted (no multi-root workspace concept in the daemon). Remove from `PersistedAgent` writes; keep the reader tolerant to extra fields for one release.

- [ ] **Step 6: Run all tests + Extension Dev Host smoke test**

Run: `npm test && npm run build`
Expected: PASS.

Manual smoke: F5 in VS Code; open the side panel; create a few agents; reload the window; verify they restore from `~/.pixel-agents/agents.json` (not workspaceState). `cat ~/.pixel-agents/agents.json` should show real data.

- [ ] **Step 7: Commit**

```bash
git add src/agentManager.ts src/PixelAgentsViewProvider.ts
git commit -m "phase-3 step 5: agentManager reads/writes ~/.pixel-agents/agents.json (was workspaceState)"
```

### Task 15: File-backed `ConfigStore` replaces `GlobalStateLike`

**Files:**

- Create: `daemon/configStore.ts`, `daemon/__tests__/configStore.test.ts`
- Modify: `src/settingsDefaults.ts`, every call site of `GlobalStateLike`/`applyCategoryDefaults`

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/configStore.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConfigStore } from '../configStore.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-cfg-'));
const file = path.join(tmp, 'config.json');

describe('createConfigStore', () => {
  it('reads and writes individual keys, persists between reloads', () => {
    const store = createConfigStore(file);
    expect(store.get<boolean>('soundEnabled')).toBeUndefined();
    store.update('soundEnabled', false);
    expect(store.get<boolean>('soundEnabled')).toBe(false);

    const store2 = createConfigStore(file);
    expect(store2.get<boolean>('soundEnabled')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/configStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/configStore.ts
import * as fs from 'node:fs';

export interface ConfigStore {
  get<T = unknown>(key: string): T | undefined;
  update(key: string, value: unknown): void;
  snapshot(): Record<string, unknown>;
}

export function createConfigStore(file: string): ConfigStore {
  const load = (): Record<string, unknown> => {
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  let data = load();
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  return {
    get<T>(key: string) {
      return data[key] as T | undefined;
    },
    update(key, value) {
      data[key] = value;
      save();
    },
    snapshot() {
      return { ...data };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run daemon/__tests__/configStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `GlobalStateLike` with `ConfigStore` in `settingsDefaults.ts`**

```ts
// src/settingsDefaults.ts
import type { ConfigStore } from '../daemon/configStore.js';

// remove GlobalStateLike export
// update the deps argument type:
deps: {
  config: ConfigStore;
  broadcast: BroadcastLike;
  office?: OfficeConfigIO;
}

// every `deps.globalState.update(KEY, value)` becomes `deps.config.update(KEY, value)`
```

- [ ] **Step 6: Update every call site to pass a `ConfigStore`**

The main call sites are in `PixelAgentsViewProvider.ts` (`applyCategoryDefaults` calls). Replace `globalState` with a `ConfigStore` instance built from `~/.pixel-agents/config.json`. The provider builds this once on activation.

- [ ] **Step 7: Run all tests + smoke test**

Run: `npm test && npm run build`
Expected: PASS. Smoke: F5; open Settings; toggle a setting; close and reopen Settings; the value persists. `cat ~/.pixel-agents/config.json` shows the keys.

- [ ] **Step 8: Commit**

```bash
git add daemon/configStore.ts daemon/__tests__/configStore.test.ts src/settingsDefaults.ts src/PixelAgentsViewProvider.ts
git commit -m "phase-3 step 5: settingsDefaults uses ConfigStore (was GlobalStateLike); settings persist to config.json"
```

### Task 16: One-shot settings backfill helper

**Files:**

- Create: `bin/import-extension-settings.ts`
- Modify: `package.json` (add a temporary `pixel-agents.exportSettings` command for the VS Code extension to dump globalState to disk)

- [ ] **Step 1: Add a one-time export command to the extension**

In `src/extension.ts` (and `package.json` contributes.commands):

```ts
vscode.commands.registerCommand('pixel-agents.exportSettings', async () => {
  const keys = [
    'pixel-agents.soundEnabled',
    'pixel-agents.watchAllSessions',
    'pixel-agents.hooksEnabled',
    'pixel-agents.alwaysShowLabels',
    'pixel-agents.showTerminalNames',
    'pixel-agents.defaultCwd',
    'pixel-agents.terminalFontFamily',
    'pixel-agents.terminalLineHeight',
    'pixel-agents.usePtyTerminal',
    // any others discovered by grep -r GLOBAL_KEY_ src/constants.ts
  ];
  const dump: Record<string, unknown> = {};
  for (const k of keys) {
    const v = context.globalState.get(k);
    if (v !== undefined) dump[k.replace(/^pixel-agents\./, '')] = v;
  }
  const out = path.join(os.tmpdir(), 'pixel-agents-settings-dump.json');
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));
  vscode.window.showInformationMessage(`Settings exported to ${out}`);
});
```

- [ ] **Step 2: Build the import CLI**

```ts
// bin/import-extension-settings.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConfigStore } from '../daemon/configStore.js';

function main() {
  const inputPath = process.argv[2] ?? path.join(os.tmpdir(), 'pixel-agents-settings-dump.json');
  if (!fs.existsSync(inputPath)) {
    console.error(
      `No dump found at ${inputPath}. Run "Pixel Agents: Export Settings" from VS Code first.`,
    );
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as Record<string, unknown>;
  const configFile = path.join(os.homedir(), '.pixel-agents', 'config.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const store = createConfigStore(configFile);
  for (const [k, v] of Object.entries(dump)) store.update(k, v);
  console.log(`Imported ${Object.keys(dump).length} settings into ${configFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 3: Write a test for the importer**

```ts
// bin/__tests__/import-extension-settings.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('import-extension-settings', () => {
  it('reads a dump file and writes to config.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-import-'));
    const dumpFile = path.join(tmp, 'dump.json');
    fs.writeFileSync(dumpFile, JSON.stringify({ soundEnabled: false, alwaysShowLabels: true }));
    const cfg = path.join(tmp, 'config.json');
    // ... invoke importer with HOME=tmp env override, assert cfg content
    process.env.HOME = tmp;
    execSync(`node --import tsx bin/import-extension-settings.ts ${dumpFile}`);
    const out = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    expect(out).toEqual({ soundEnabled: false, alwaysShowLabels: true });
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run bin/__tests__/import-extension-settings.test.ts`
Expected: PASS (the test may need `tsx` available; if not, compile to .js first and run the compiled output).

- [ ] **Step 5: Commit**

```bash
git add bin/import-extension-settings.ts bin/__tests__/import-extension-settings.test.ts src/extension.ts package.json
git commit -m "phase-3 step 5: one-shot extension settings export+import helper for config.json backfill"
```

---

## Phase 6 — Pty-only + Alt-based Hotkeys (CUTOVER PART 1)

Goal: remove the `vscode.window.createTerminal` fallback; remap canvas/terminal shortcuts to `Alt`-based chords. **After this phase, the extension's terminal fallback is gone — there is no rollback to native VS Code terminals.** Soak the pty backend on every active agent before starting.

### Task 17: Remove the legacy `createTerminal` path from `agentManager`

**Files:**

- Modify: `src/agentManager.ts`, `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Find every reference to `usePtyTerminal` and the legacy path**

Run: `grep -rn "usePtyTerminal\|createTerminal" src/`
List the references. Expected: a branch in `agentManager.launchNewTerminal` that picks pty vs `vscode.window.createTerminal`; references in settings UI.

- [ ] **Step 2: Delete the legacy branch in `launchNewTerminal`**

```ts
// before (simplified)
if (usePtyTerminal) {
  return launchPtyTerminal(...);
} else {
  return vscode.window.createTerminal(...);
}

// after
return launchPtyTerminal(...);
```

Remove the `usePtyTerminal` parameter from the function signature; update every caller.

- [ ] **Step 3: Delete the setting**

Remove `usePtyTerminal` from:

- `src/constants.ts` (`GLOBAL_KEY_USE_PTY_TERMINAL`, `DEFAULT_SETTINGS.terminal.usePtyTerminal`)
- `src/settingsDefaults.ts` (the `applyCategoryDefaults('terminal')` branch — drop the line that writes it)
- `webview-ui/src/components/settings/sections/TerminalSection.tsx` (the toggle row)
- Any test that asserts on it

- [ ] **Step 4: Run all tests + build**

Run: `npm test && npm run build`
Expected: PASS. Some tests that mocked the legacy path may need updates; that's expected — drop those assertions.

- [ ] **Step 5: Smoke test in Extension Dev Host**

F5; create a new agent; verify it spawns through pty (xterm.js pane), not the VS Code terminal strip. Run a long-running command; verify output streams.

- [ ] **Step 6: Commit**

```bash
git add src/ webview-ui/src/components/settings/sections/TerminalSection.tsx
git commit -m "phase-3 step 6: remove legacy vscode.window.createTerminal path; pty is the only terminal backend"
```

### Task 18: Remap Cmd/Ctrl canvas shortcuts to Alt

**Files:**

- Modify: `webview-ui/src/hooks/useEditorKeyboard.ts`, `webview-ui/src/office/panel/TerminalPane.tsx`, anywhere else `event.metaKey || event.ctrlKey` gates a hotkey

- [ ] **Step 1: Enumerate every Cmd/Ctrl-based shortcut**

Run: `grep -rn "metaKey\|ctrlKey" webview-ui/src/ | grep -v "\.test\."`
List them. Expected hits: `Cmd/Ctrl+1..9` (rail-focus), `Cmd/Ctrl+'` (panel collapse), `Cmd/Ctrl+F` (terminal search), `Cmd/Ctrl+Z/Y` (editor undo/redo).

- [ ] **Step 2: Replace `metaKey || ctrlKey` with `altKey` for canvas/terminal chords**

Editor undo (`Cmd/Ctrl+Z`) is the borderline case — undo is also a "normal" browser chord in text inputs. The spec says remap to `Alt+Z` to avoid the collision; do that.

```ts
// before
if ((event.metaKey || event.ctrlKey) && event.key === '1') ...

// after
if (event.altKey && event.key === '1') ...
```

- [ ] **Step 3: Update the Phase 2 QA checklist's "Canvas keyboard shortcuts" section**

Edit `docs/playtests/2026-05-13-phase-2-qa-checklist.md` section 3.8: replace every Cmd/Ctrl with Alt. Add a note: "Browser tab claims Cmd/Ctrl+1..9 etc; canvas chords moved to Alt-based for the combined Phase 2+3 release."

- [ ] **Step 4: Update tests for the new chords**

Find tests that simulate `metaKey: true`; flip them to `altKey: true`.

- [ ] **Step 5: Run all tests + smoke test**

Run: `npm test`
Expected: PASS. Smoke: F5; press Alt+1, Alt+2, etc. Verify rail-focus works; press Alt+F in terminal to open search.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/ docs/playtests/2026-05-13-phase-2-qa-checklist.md
git commit -m "phase-3 step 6: remap canvas/terminal hotkeys from Cmd/Ctrl to Alt (browser tab compatibility)"
```

---

## Phase 7 — Cutover Commit

Goal: delete the VS Code extension code. Daemon becomes the only entry point. Repo's `package.json` reshapes around `bin/serve.ts`.

### Task 19: Daemon startup PID-prune

**Files:**

- Create: `daemon/agentsBootCleanup.ts`, `daemon/__tests__/agentsBootCleanup.test.ts`
- Modify: `bin/serve.ts`

- [ ] **Step 1: Write the failing test**

```ts
// daemon/__tests__/agentsBootCleanup.test.ts
import { describe, it, expect } from 'vitest';
import { pruneDeadAgents } from '../agentsBootCleanup.js';

describe('pruneDeadAgents', () => {
  it('drops entries whose pid is no longer alive', () => {
    const file = {
      version: 1 as const,
      nextAgentId: 3,
      nextTerminalIndex: 3,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
          sessionId: 's1',
        },
        {
          id: 2,
          terminalName: 't2',
          jsonlFile: '/tmp/b',
          projectDir: '/tmp',
          palette: 1,
          hueShift: 0,
          sessionId: 's2',
        },
      ],
    };
    const pidOf = (sessionId: string) => (sessionId === 's1' ? 11111 : 22222);
    const alive = (pid: number) => pid === 11111;
    const cleaned = pruneDeadAgents(file, { pidOf, alive });
    expect(cleaned.agents.map((a) => a.sessionId)).toEqual(['s1']);
  });

  it('keeps external agents (no pid) intact', () => {
    const file = {
      version: 1 as const,
      nextAgentId: 2,
      nextTerminalIndex: 2,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
          isExternal: true,
        },
      ],
    };
    const cleaned = pruneDeadAgents(file, { pidOf: () => undefined, alive: () => false });
    expect(cleaned.agents).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run daemon/__tests__/agentsBootCleanup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// daemon/agentsBootCleanup.ts
import type { AgentsFile, PersistedAgent } from './agentsPersistence.js';

export function pruneDeadAgents(
  file: AgentsFile,
  deps: {
    pidOf: (sessionId: string) => number | undefined;
    alive: (pid: number) => boolean;
  },
): AgentsFile {
  const keep: PersistedAgent[] = [];
  for (const a of file.agents) {
    if (a.isExternal) {
      keep.push(a);
      continue;
    }
    const pid = a.sessionId ? deps.pidOf(a.sessionId) : undefined;
    if (pid === undefined) {
      keep.push(a);
      continue;
    }
    if (deps.alive(pid)) keep.push(a);
  }
  return { ...file, agents: keep };
}
```

- [ ] **Step 4: Wire into `startDaemon`**

In `bin/serve.ts`, after `ensureHookScript` but before `server.start()`:

```ts
import { readAgents, writeAgents } from '../daemon/agentsPersistence.js';
import { pruneDeadAgents } from '../daemon/agentsBootCleanup.js';
import * as path from 'node:path';
import * as os from 'node:os';

const agentsFile = path.join(os.homedir(), '.pixel-agents', 'agents.json');
const before = readAgents(agentsFile);
const after = pruneDeadAgents(before, {
  // In v1 we don't track pty PIDs across daemon restarts — every pty-backed agent
  // is assumed dead after a daemon restart. The PtyManager re-spawn isn't yet
  // implemented; the user will manually re-create agents post-restart.
  pidOf: () => undefined,
  alive: () => false,
});
// surviving entries (externals, plus any future PID-tracked agents) stay.
if (after.agents.length !== before.agents.length) writeAgents(agentsFile, after);
```

(Once `PtyManager` learns to persist PIDs per agent — a follow-up — the `pidOf` callback returns the real PID. For v1, conservatively drop every pty-backed agent on restart.)

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add daemon/agentsBootCleanup.ts daemon/__tests__/agentsBootCleanup.test.ts bin/serve.ts
git commit -m "phase-3 step 7: daemon startup prunes agents whose pty is no longer alive"
```

### Task 20: Delete extension code

**Files:**

- Delete: `src/extension.ts`, `src/PixelAgentsViewProvider.ts`
- Modify: `webview-ui/src/vscodeApi.ts` (delete VS Code branch), `package.json` (drop activation events + contributes.\*), `src/constants.ts` (drop VS Code-only keys)

- [ ] **Step 1: Verify nothing in `src/` still imports `extension.ts` or `PixelAgentsViewProvider.ts`**

Run: `grep -rn "from './extension\|from './PixelAgentsViewProvider\|import.*PixelAgentsViewProvider" src/`
Expected: no hits (these files only re-export to themselves; downstream is via the daemon now).

- [ ] **Step 2: Delete the files**

```bash
git rm src/extension.ts src/PixelAgentsViewProvider.ts
```

- [ ] **Step 3: Simplify `vscodeApi.ts` — delete the VS Code branch**

```ts
// webview-ui/src/vscodeApi.ts (post-cutover)
import { createWsClient } from './wsClient';

export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
}

const wsUrl = `ws://${location.host}/ws?token=${encodeURIComponent(
  document.querySelector<HTMLMetaElement>('meta[name="px-token"]')?.content ?? '',
)}`;
const client = createWsClient({
  url: wsUrl,
  onMessage: (msg) => window.dispatchEvent(new MessageEvent('message', { data: msg })),
});

export const vscode: VSCodeApi = {
  postMessage: (msg) => client.postMessage(msg),
  getState: <T>() =>
    localStorage.getItem('px-state')
      ? (JSON.parse(localStorage.getItem('px-state')!) as T)
      : undefined,
  setState: <T>(state: T) => {
    localStorage.setItem('px-state', JSON.stringify(state));
    return state;
  },
};
```

- [ ] **Step 4: Trim `package.json`**

Remove these top-level keys:

- `activationEvents`
- `contributes` (commands, views, menus, configuration)
- `main` (extension entry — change to `bin/serve.js` once compiled)
- `engines.vscode`

Add:

- `bin`: `{ "pixel-agents": "dist/bin/serve.js" }`
- Update `scripts.start` to `node dist/bin/serve.js`.

- [ ] **Step 5: Trim `src/constants.ts`**

Remove VS Code command IDs (`COMMAND_OPEN_FULL_SCREEN`, etc.) and view IDs. Keep timing/parsing constants.

- [ ] **Step 6: Run all tests + build**

Run: `npm test && npm run build`
Expected: PASS. The build no longer produces a `.vsix`-ready extension; it produces a CLI.

- [ ] **Step 7: Manual end-to-end test**

Run: `node dist/bin/serve.js`
Expected: daemon starts; browser opens to `http://127.0.0.1:<port>`; SPA loads; agents work; multi-tab sync works.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "phase-3 step 7 (CUTOVER): delete extension code; daemon is the only entry point"
```

### Task 21: README + ROADMAP updates

**Files:**

- Modify: `README.md` (rewrite for personal CLI), `docs/ROADMAP.md` (mark Phase 3 shipped)

- [ ] **Step 1: Rewrite the README**

Replace the VS Code-extension-oriented README with a personal-CLI-oriented one. Sections:

- What it is (one-paragraph pitch)
- Install (`git clone && npm install && npm run build`)
- Run (`node dist/bin/serve.js`)
- First-run (`node dist/bin/install-hooks`)
- Development (F5 path is gone; replace with `npm run dev`)

- [ ] **Step 2: Update `docs/ROADMAP.md`**

Mark Phase 3 shipped:

```markdown
## Phase 3 — Standalone remote app (shipped 2026-MM-DD)

**What changed:** Daemon + browser SPA replace the VS Code extension. localhost-only.
The extension code is gone; the office runs as a browser tab pointed at `pixel-agents serve`.

[summary of bundles + commit refs]
```

Move the previous Phase 3 § text into a "shipped" record. Add a new "Phase 4 — LAN/Remote" section if planning to keep going.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ROADMAP.md
git commit -m "phase-3: README + roadmap reflect cutover (Pixel Agents is now a CLI + browser SPA)"
```

---

## Final verification

After Task 21, run a full combined Phase 2 + Phase 3 QA pass against the updated `docs/playtests/2026-05-13-phase-2-qa-checklist.md`:

- [ ] Replace "Extension Dev Host" with "`node dist/bin/serve.js`" in every section.
- [ ] Walk through every checkbox.
- [ ] Add Phase 3-specific sections (daemon lifecycle, multi-tab sync, hook installer, settings persistence, daemon restart pruning).
- [ ] Mark `Status: PASS` at the top of the checklist when done; commit.
- [ ] Tag the release: `git tag v2.0.0 -m "Phase 2 + 3 combined release"`

---

## Plan self-review

**Coverage of the spec sections:**

| Spec section                | Tasks                              |
| --------------------------- | ---------------------------------- |
| Module migration table      | Tasks 1, 2, 3, 17, 20              |
| MessageSink / MessageSource | Tasks 5, 8                         |
| webview-ui SPA              | Task 8 (also 9 for serving)        |
| Workspace concept           | Implicit in Task 14 (single scope) |
| Persistence (agents)        | Tasks 13, 14                       |
| Persistence (settings)      | Tasks 15, 16                       |
| Daemon lifecycle            | Tasks 10, 11                       |
| HTTP routes                 | Tasks 6 (WS), 9 (static)           |
| Multi-tab sync              | Task 6 (broadcast set)             |
| Security on localhost       | Task 6                             |
| Snapshot-on-open replay     | Task 7                             |
| Hook script ownership       | Task 12                            |
| Browser hotkey remap        | Task 18                            |
| Daemon-restart pty cleanup  | Task 19                            |
| Cutover                     | Tasks 20, 21                       |
| Testing strategy            | Inline in every task               |

**Type / signature consistency:**

- `Disposable` introduced in Task 1, consumed in Tasks 2, 5.
- `MessageSink` / `MessageSource` already exist; only the transport changes.
- `PersistedAgent` / `AgentsFile` introduced in Task 13, consumed in Tasks 14, 19.
- `ConfigStore` introduced in Task 15, consumed in Task 16.
- `WebSocketSink` / `WebSocketBroadcast` / `WebSocketSource` introduced in Task 5, consumed in Tasks 6, 7.
- `acceptUpgrade` introduced in Task 6, no other consumer.
- `replaySnapshot` introduced in Task 7, called from the WS connect handler.
- `ensureHookScript` introduced in Task 12, called from `startDaemon` (Task 10/12).
- `pruneDeadAgents` introduced in Task 19, called from `startDaemon` (Task 19).

No naming drift detected.

**Commit count estimate:** 21 commits (one per task). Combined with the ~8 task-internal commit steps (where some tasks have multiple commits), total ~25 commits land Phase 3. Plus the Phase 2 backlog already on the branch = ~100 commits total for the combined release.
