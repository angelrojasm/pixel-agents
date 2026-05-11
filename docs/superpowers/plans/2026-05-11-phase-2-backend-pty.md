# Phase 2 Backend — MessageSource + node-pty + pty protocol — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two prerequisites that unblock the actual "terminal inside the office" experience — D1 (`MessageSource` inbound abstraction) and D2 (`node-pty` backend + scrollback buffer + new pty protocol messages). After this plan ships, `TerminalPaneStub` can be replaced with a real `TerminalPane` in a separate plan, and the same code paths slot cleanly into the Phase-3 daemon + WebSocket transport.

**Architecture:** D1 introduces a `MessageSource` interface that mirrors `MessageSink` for the inbound path. A `webviewMessageSource(webview)` adapter wraps `vscode.Webview.onDidReceiveMessage` so the provider's dispatch logic never touches the `vscode`-shaped event directly. D2 adds a per-agent `PtyWorker` that owns a `node-pty` child process for an agent, exposes a bounded scrollback ring buffer, and emits a tiny protocol (`ptyData` / `ptyExit` / `ptyScrollback` outbound; `ptyInput` / `ptyResize` / `terminalPaneReady` inbound). Agents acquire `ptyBacked: true` only when a feature flag is on — the legacy `vscode.window.createTerminal` path stays parallel and is the default in this plan. Replacing the `TerminalPaneStub` with the real terminal is **out of scope here**.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, no enums), Node.js, `node-pty` (new native dep), existing `node:test` + Vitest harnesses. No changes to the webview build.

**Parent specs:**

- `docs/superpowers/specs/2026-04-21-remote-office-vision.md` (Phase-3 trajectory, principle #5 = `MessageSource`)
- `docs/superpowers/specs/2026-04-21-phase-2-drawer-ux-design.md` (D1 + D2 listed as out-of-scope dependencies)

---

## Preconditions

- Branch: do this work on a new branch `feature/phase-2-backend-pty` off current `main`.
- All existing 137 tests pass on `main`.
- No webview-side changes in this plan; the webview keeps rendering `TerminalPaneStub`. Once D1 + D2 land, a follow-up plan replaces the stub.

---

## Scope split

This plan covers two related-but-separable units. Each is internally TDD-driven and ends in a commit.

- **Part A (D1) — MessageSource refactor.** Pure structural. ~4 tasks. Behaviour unchanged.
- **Part B (D2) — node-pty backend + pty protocol.** New native dep + new module. ~8 tasks. Adds the pty path behind a flag; no UI consumes it yet.

---

## File Structure

**Part A — new files:**

| File                                  | Responsibility                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `src/messageSource.ts`                | `webviewMessageSource(webview): MessageSource` adapter (single function) |
| `src/__tests__/messageSource.test.ts` | Unit test that the adapter forwards messages to the registered handler   |

**Part A — modified files:**

| File                             | Change                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                   | Add `MessageSource` interface alongside `MessageSink`                                                  |
| `src/PixelAgentsViewProvider.ts` | Replace direct `webview.onDidReceiveMessage(...)` calls with `webviewMessageSource(...)onMessage(...)` |

**Part B — new files:**

| File                                    | Responsibility                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pty/ringBuffer.ts`                 | Pure `RingBuffer<T>` class with bounded `push(item)` + `replay(): T[]`                                                                    |
| `src/pty/__tests__/ringBuffer.test.ts`  | Unit tests for the ring buffer (push past capacity, replay order, clear)                                                                  |
| `src/pty/ptyWorker.ts`                  | `PtyWorker` class — owns a node-pty `IPty`, exposes `write(data)`, `resize(cols, rows)`, `onData`, `onExit`, `scrollback()`               |
| `src/pty/__tests__/ptyWorker.test.ts`   | Integration test: spawn a real `/bin/echo hi`, assert data + exit, assert scrollback replay                                               |
| `src/pty/ptyProtocol.ts`                | Type definitions and tiny pure helpers for the new protocol messages (no behavior — just the shape)                                       |
| `src/pty/__tests__/ptyProtocol.test.ts` | Tests that helpers (e.g. `isPtyInputMessage`) classify messages correctly                                                                 |
| `src/pty/ptyManager.ts`                 | `PtyManager` — owns per-agent `PtyWorker`s, bridges to `MessageSink` (out) and `MessageSource` (in), handles late-mount scrollback replay |
| `src/pty/__tests__/ptyManager.test.ts`  | Integration test that PtyManager wires output/input correctly with mock sink/source                                                       |

**Part B — modified files:**

| File                             | Change                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `package.json`                   | Add `node-pty` dependency                                                                                        |
| `server/src/constants.ts`        | Add `PTY_SCROLLBACK_MAX_LINES`, `PTY_MAX_CHUNK_BYTES`                                                            |
| `src/types.ts`                   | Add `ptyBacked?: boolean` flag to `AgentState` (default `false`)                                                 |
| `src/PixelAgentsViewProvider.ts` | Instantiate `PtyManager`, register inbound pty handlers through `MessageSource`, dispose on extension deactivate |
| `src/agentManager.ts`            | Initialize `ptyBacked: false` on every new agent (legacy path stays default)                                     |

**No webview-side files change in this plan.** That happens in the follow-up plan that wires `TerminalPaneStub` to a real `TerminalPane`.

---

# Part A — D1: MessageSource refactor

## Task 1: Create the branch + add `MessageSource` interface

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Create branch off main**

```bash
cd /Users/angel/Desktop/pixel-agents
git checkout main
git pull --ff-only
git checkout -b feature/phase-2-backend-pty
git status   # expect clean
```

- [ ] **Step 2: Read the existing `MessageSink` block to know exactly where to add the new interface**

Look at `src/types.ts:1-20`. The new interface goes immediately after `MessageSink`.

- [ ] **Step 3: Add `MessageSource` interface**

Insert the following after the `MessageSink` interface and before `AgentState` in `src/types.ts`:

```ts
/**
 * Inbound counterpart to MessageSink. Abstracts the path that delivers messages
 * FROM a webview (or a future WebSocket transport) into the extension. Matches
 * the shape used by `vscode.Webview.onDidReceiveMessage` so wiring stays small.
 *
 * Today's implementation wraps `vscode.Webview` (see `webviewMessageSource`).
 * Phase 3 will swap in a WebSocket-backed source for the same handler.
 *
 * The interface returns `vscode.Disposable` rather than a custom shape so
 * consumers can register the result into `context.subscriptions`.
 */
export interface MessageSource {
  onMessage(handler: (message: Record<string, unknown>) => unknown): vscode.Disposable;
}
```

- [ ] **Step 4: Type-check passes**

```bash
npx tsc -b --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add MessageSource interface (inbound counterpart to MessageSink)"
```

---

## Task 2: Write the `webviewMessageSource` test first

**Files:**

- Create: `src/__tests__/messageSource.test.ts`

The project uses Vitest for `__tests__` directories in the extension (`server/__tests__/` uses it). We'll mirror that style for the extension-side test.

- [ ] **Step 1: Verify Vitest is available for the extension side**

```bash
grep -l "vitest" package.json server/package.json
```

If the extension's root `package.json` doesn't list Vitest in `devDependencies`, install it:

```bash
npm install --save-dev vitest
```

Skip install if it's already present.

- [ ] **Step 2: Confirm a "test:extension" or equivalent script exists**

Open `package.json` and look at `scripts`. If there's no script that runs Vitest against `src/__tests__/`, add one:

```json
"test:extension": "vitest run src/__tests__"
```

Run `npm run test:extension` and confirm it runs to completion (zero tests is OK).

- [ ] **Step 3: Write the failing test**

Create `src/__tests__/messageSource.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { webviewMessageSource } from '../messageSource.js';

// Minimal mock that matches the shape of `vscode.Webview` for our purposes.
function makeMockWebview() {
  type Handler = (m: Record<string, unknown>) => unknown;
  const handlers: Handler[] = [];
  return {
    handlers,
    onDidReceiveMessage(h: Handler) {
      handlers.push(h);
      return {
        dispose: () => {
          const idx = handlers.indexOf(h);
          if (idx >= 0) handlers.splice(idx, 1);
        },
      };
    },
    emit(message: Record<string, unknown>) {
      for (const h of handlers) h(message);
    },
  };
}

describe('webviewMessageSource', () => {
  it('forwards messages from the wrapped webview to the registered handler', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const received: Record<string, unknown>[] = [];

    source.onMessage((m) => received.push(m));
    mock.emit({ type: 'ping' });
    mock.emit({ type: 'pong', n: 2 });

    expect(received).toEqual([{ type: 'ping' }, { type: 'pong', n: 2 }]);
  });

  it('returns a disposable that detaches the handler', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const received: Record<string, unknown>[] = [];

    const sub = source.onMessage((m) => received.push(m));
    mock.emit({ type: 'before' });
    sub.dispose();
    mock.emit({ type: 'after' });

    expect(received).toEqual([{ type: 'before' }]);
  });

  it('supports multiple independent handlers on the same source', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const a: Record<string, unknown>[] = [];
    const b: Record<string, unknown>[] = [];

    source.onMessage((m) => a.push(m));
    source.onMessage((m) => b.push(m));
    mock.emit({ type: 'broadcast' });

    expect(a).toEqual([{ type: 'broadcast' }]);
    expect(b).toEqual([{ type: 'broadcast' }]);
  });

  it('does not throw when emit happens with no handlers registered', () => {
    const mock = makeMockWebview();
    webviewMessageSource(mock as never); // intentionally no .onMessage

    expect(() => mock.emit({ type: 'orphan' })).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the test, watch it fail**

```bash
npm run test:extension
```

Expected: FAIL — `webviewMessageSource` is not defined (the module doesn't exist yet).

---

## Task 3: Implement `webviewMessageSource`

**Files:**

- Create: `src/messageSource.ts`

- [ ] **Step 1: Create the adapter**

Write `src/messageSource.ts`:

```ts
import type * as vscode from 'vscode';

import type { MessageSource } from './types.js';

/**
 * Adapter that exposes a `vscode.Webview` through the transport-agnostic
 * `MessageSource` interface. Consumers register a handler via `onMessage(...)`
 * instead of touching `webview.onDidReceiveMessage` directly, so the inbound
 * path is ready to swap to a WebSocket transport in Phase 3 without changes
 * to the provider's message dispatch logic.
 */
export function webviewMessageSource(webview: vscode.Webview): MessageSource {
  return {
    onMessage(handler) {
      return webview.onDidReceiveMessage(handler);
    },
  };
}
```

- [ ] **Step 2: Run the test, watch it pass**

```bash
npm run test:extension
```

Expected: all four `webviewMessageSource` tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/messageSource.test.ts src/messageSource.ts package.json
git commit -m "feat(extension): webviewMessageSource adapter (D1 — inbound abstraction)"
```

(Include `package.json` only if you added Vitest or a new script in Task 2.)

---

## Task 4: Wire the provider through `MessageSource`

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Add the import**

In `src/PixelAgentsViewProvider.ts`, find the import block. Add:

```ts
import { webviewMessageSource } from './messageSource.js';
```

Place it alphabetically near `./timerManager.js` / `./transcriptParser.js` (the existing per-file imports). The imports are auto-sorted by `simple-import-sort`, so the run-lint-fix step at the end will tidy them up.

- [ ] **Step 2: Replace the side-panel inbound wiring**

Find this line inside `resolveWebviewView`:

```ts
webviewView.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message));
```

Replace with:

```ts
// Inbound messages flow through the MessageSource abstraction so the Phase-3
// WebSocket transport can swap in without touching the provider's dispatch logic.
webviewMessageSource(webviewView.webview).onMessage((message) =>
  this.handleWebviewMessage(message),
);
```

- [ ] **Step 3: Replace the full-screen panel inbound wiring**

Inside `openFullScreenPanel`, find:

```ts
panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message));
```

Replace with:

```ts
webviewMessageSource(panel.webview).onMessage((message) => this.handleWebviewMessage(message));
```

- [ ] **Step 4: Confirm no other call to `onDidReceiveMessage` exists**

```bash
grep -rn "onDidReceiveMessage" src/ server/src/
```

Expected output: zero matches. (The wrapping centralises this access; downstream code already uses `MessageSink` only.)

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc -b --noEmit
npm run lint
```

Expected: clean. If lint complains about import order, run `npm run lint -- --fix`.

- [ ] **Step 6: Full test run**

```bash
npm test
```

Expected: all existing tests still pass (137 + 4 new = 141 total).

- [ ] **Step 7: Manual sanity build**

```bash
npm run package
```

Expected: builds cleanly (esbuild + vite both finish without error).

- [ ] **Step 8: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "refactor(provider): route inbound webview messages through MessageSource"
```

D1 complete.

---

# Part B — D2: node-pty backend + pty protocol

## Task 5: Add `node-pty` dependency

**Files:**

- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install node-pty**

```bash
npm install node-pty
```

`node-pty` is a native module; npm will build it against the current Node version. macOS and Linux are well-supported; Windows uses ConPTY and is rougher (the parent spec mitigates Windows by shipping a Docker image; we accept that constraint).

- [ ] **Step 2: Verify install**

```bash
node -e "const pty = require('node-pty'); console.log(typeof pty.spawn)"
```

Expected output: `function`.

- [ ] **Step 3: Commit the lockfile + package.json**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add node-pty (D2 — backend pty pipeline)"
```

---

## Task 6: Add pty constants

**Files:**

- Modify: `server/src/constants.ts`

- [ ] **Step 1: Append constants**

Add at the end of `server/src/constants.ts`:

```ts
// ── Pty Backend (D2 — Phase 2 backend pipeline) ────────────
/** Maximum number of pty output chunks (lines or chunks) held in the per-agent
 *  scrollback ring buffer. Replayed to late-mounting webviews so a freshly
 *  opened panel shows recent terminal history. */
export const PTY_SCROLLBACK_MAX_LINES = 2000;
/** Hard cap on a single pty output chunk forwarded to the webview. Pathological
 *  output (massive single writes) is split or truncated to protect the
 *  postMessage channel from a runaway producer. */
export const PTY_MAX_CHUNK_BYTES = 1_048_576; // 1 MiB
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -b --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/constants.ts
git commit -m "feat(constants): pty scrollback + chunk-size limits"
```

---

## Task 7: RingBuffer (TDD)

**Files:**

- Create: `src/pty/ringBuffer.ts`
- Create: `src/pty/__tests__/ringBuffer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pty/__tests__/ringBuffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { RingBuffer } from '../ringBuffer.js';

describe('RingBuffer', () => {
  it('push + replay returns items in insertion order', () => {
    const rb = new RingBuffer<string>(10);
    rb.push('a');
    rb.push('b');
    rb.push('c');
    expect(rb.replay()).toEqual(['a', 'b', 'c']);
  });

  it('replay returns an empty array on a fresh buffer', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.replay()).toEqual([]);
  });

  it('drops oldest items once capacity is exceeded', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // evicts 1
    rb.push(5); // evicts 2
    expect(rb.replay()).toEqual([3, 4, 5]);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer<string>(5);
    rb.push('x');
    rb.push('y');
    rb.clear();
    expect(rb.replay()).toEqual([]);
  });

  it('size reports the current item count', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.size()).toEqual(0);
    rb.push(1);
    rb.push(2);
    expect(rb.size()).toEqual(2);
    rb.push(3);
    rb.push(4); // evicts 1, size still 3
    expect(rb.size()).toEqual(3);
    rb.clear();
    expect(rb.size()).toEqual(0);
  });

  it('replay returns a snapshot (mutating it does not affect the buffer)', () => {
    const rb = new RingBuffer<string>(3);
    rb.push('a');
    const out = rb.replay();
    out.push('mutated');
    expect(rb.replay()).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run, watch fail**

```bash
npm run test:extension
```

Expected: FAIL — `RingBuffer` not defined.

- [ ] **Step 3: Implement**

Create `src/pty/ringBuffer.ts`:

```ts
/**
 * Bounded FIFO buffer used as a scrollback ring for pty output. Once `capacity`
 * is exceeded, the oldest item is evicted on each new push. `replay()` returns
 * a defensive copy in insertion order; mutating the returned array does not
 * affect the buffer.
 */
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error(`RingBuffer capacity must be positive (got ${capacity})`);
    }
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  replay(): T[] {
    return this.items.slice();
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
```

- [ ] **Step 4: Run, watch pass**

```bash
npm run test:extension
```

Expected: all six `RingBuffer` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pty/ringBuffer.ts src/pty/__tests__/ringBuffer.test.ts
git commit -m "feat(pty): bounded RingBuffer for scrollback"
```

---

## Task 8: Pty protocol types

**Files:**

- Create: `src/pty/ptyProtocol.ts`
- Create: `src/pty/__tests__/ptyProtocol.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pty/__tests__/ptyProtocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  isPtyInputMessage,
  isPtyResizeMessage,
  isTerminalPaneReadyMessage,
} from '../ptyProtocol.js';

describe('ptyProtocol guards', () => {
  it('isPtyInputMessage recognises valid input', () => {
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1, data: 'x' })).toBe(true);
  });

  it('isPtyInputMessage rejects wrong type, missing fields, wrong field types', () => {
    expect(isPtyInputMessage({ type: 'other', agentId: 1, data: 'x' })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1 })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: '1', data: 'x' })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1, data: 5 })).toBe(false);
    expect(isPtyInputMessage(null)).toBe(false);
    expect(isPtyInputMessage('ptyInput')).toBe(false);
  });

  it('isPtyResizeMessage recognises valid resize', () => {
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 80, rows: 24 })).toBe(true);
  });

  it('isPtyResizeMessage rejects non-positive dimensions', () => {
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 0, rows: 24 })).toBe(false);
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 80, rows: -1 })).toBe(false);
  });

  it('isTerminalPaneReadyMessage recognises valid ready signal', () => {
    expect(isTerminalPaneReadyMessage({ type: 'terminalPaneReady', agentId: 3 })).toBe(true);
    expect(isTerminalPaneReadyMessage({ type: 'terminalPaneReady' })).toBe(false);
    expect(isTerminalPaneReadyMessage({ type: 'other', agentId: 3 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, watch fail**

```bash
npm run test:extension
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `src/pty/ptyProtocol.ts`:

```ts
/**
 * Wire types and runtime guards for the new pty protocol messages exchanged
 * between extension and webview. The guards exist so the provider can route
 * incoming messages safely without trusting the typing layer alone — inbound
 * messages cross a `postMessage` boundary that erases types at runtime.
 *
 * Outbound (extension → webview):
 *  - `ptyData` { agentId, data }
 *  - `ptyExit` { agentId, code, signal? }
 *  - `ptyScrollback` { agentId, lines: string[] }
 *
 * Inbound (webview → extension):
 *  - `ptyInput` { agentId, data }
 *  - `ptyResize` { agentId, cols, rows }
 *  - `terminalPaneReady` { agentId }
 */

export interface PtyDataMessage {
  type: 'ptyData';
  agentId: number;
  data: string;
}

export interface PtyExitMessage {
  type: 'ptyExit';
  agentId: number;
  code: number;
  signal?: string;
}

export interface PtyScrollbackMessage {
  type: 'ptyScrollback';
  agentId: number;
  lines: string[];
}

export interface PtyInputMessage {
  type: 'ptyInput';
  agentId: number;
  data: string;
}

export interface PtyResizeMessage {
  type: 'ptyResize';
  agentId: number;
  cols: number;
  rows: number;
}

export interface TerminalPaneReadyMessage {
  type: 'terminalPaneReady';
  agentId: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isPtyInputMessage(v: unknown): v is PtyInputMessage {
  if (!isRecord(v)) return false;
  return v.type === 'ptyInput' && typeof v.agentId === 'number' && typeof v.data === 'string';
}

export function isPtyResizeMessage(v: unknown): v is PtyResizeMessage {
  if (!isRecord(v)) return false;
  return (
    v.type === 'ptyResize' &&
    typeof v.agentId === 'number' &&
    typeof v.cols === 'number' &&
    v.cols > 0 &&
    typeof v.rows === 'number' &&
    v.rows > 0
  );
}

export function isTerminalPaneReadyMessage(v: unknown): v is TerminalPaneReadyMessage {
  if (!isRecord(v)) return false;
  return v.type === 'terminalPaneReady' && typeof v.agentId === 'number';
}
```

- [ ] **Step 4: Run, watch pass**

```bash
npm run test:extension
```

Expected: all five `ptyProtocol` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pty/ptyProtocol.ts src/pty/__tests__/ptyProtocol.test.ts
git commit -m "feat(pty): protocol message types + runtime guards"
```

---

## Task 9: PtyWorker — wrap node-pty

**Files:**

- Create: `src/pty/ptyWorker.ts`
- Create: `src/pty/__tests__/ptyWorker.test.ts`

`PtyWorker` owns a single `node-pty.IPty`. It exposes `write`, `resize`, `kill`, `onData`, `onExit`, and a `scrollback()` accessor backed by `RingBuffer<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/pty/__tests__/ptyWorker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PtyWorker } from '../ptyWorker.js';

const SHELL = '/bin/sh';

describe('PtyWorker (integration with node-pty)', () => {
  it('captures stdout from a short-lived process and reports exit code 0', async () => {
    const worker = new PtyWorker({
      shell: SHELL,
      args: ['-c', "printf 'hello\\n'"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
      scrollbackCapacity: 100,
    });

    const data: string[] = [];
    worker.onData((chunk) => data.push(chunk));

    const exit = await new Promise<{ code: number; signal?: string }>((resolve) => {
      worker.onExit(resolve);
    });

    expect(exit.code).toBe(0);
    expect(data.join('')).toContain('hello');
  });

  it('scrollback() replays captured chunks in order', async () => {
    const worker = new PtyWorker({
      shell: SHELL,
      args: ['-c', "printf 'a\\nb\\nc\\n'"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
      scrollbackCapacity: 100,
    });

    await new Promise<void>((resolve) => worker.onExit(() => resolve()));
    const replay = worker.scrollback().join('');
    expect(replay).toContain('a');
    expect(replay).toContain('b');
    expect(replay).toContain('c');
  });

  it('kill() terminates the process', async () => {
    const worker = new PtyWorker({
      shell: SHELL,
      args: ['-c', 'sleep 30'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
      scrollbackCapacity: 100,
    });

    const exitPromise = new Promise<{ code: number; signal?: string }>((resolve) => {
      worker.onExit(resolve);
    });

    worker.kill();
    const exit = await exitPromise;
    // SIGTERM (15) or SIGHUP — either is fine; we just want non-zero or a signal.
    expect(exit.code !== 0 || exit.signal !== undefined).toBe(true);
  });
});
```

- [ ] **Step 2: Run, watch fail**

```bash
npm run test:extension
```

Expected: FAIL — `PtyWorker` not defined.

- [ ] **Step 3: Implement**

Create `src/pty/ptyWorker.ts`:

```ts
import * as pty from 'node-pty';

import { RingBuffer } from './ringBuffer.js';

export interface PtyWorkerOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  scrollbackCapacity: number;
}

type DataHandler = (chunk: string) => void;
type ExitHandler = (info: { code: number; signal?: string }) => void;

/**
 * Owns a single node-pty child process for one agent. Captures all output into
 * a bounded scrollback buffer so a freshly-mounted webview can replay recent
 * history. Translation to the wire protocol happens one layer up in PtyManager.
 */
export class PtyWorker {
  private readonly child: pty.IPty;
  private readonly buffer: RingBuffer<string>;
  private readonly dataHandlers: DataHandler[] = [];
  private readonly exitHandlers: ExitHandler[] = [];
  private alive = true;

  constructor(opts: PtyWorkerOptions) {
    this.buffer = new RingBuffer<string>(opts.scrollbackCapacity);
    // node-pty wants string-only env values; drop undefined entries.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.env)) {
      if (typeof v === 'string') env[k] = v;
    }

    this.child = pty.spawn(opts.shell, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env,
    });

    this.child.onData((chunk) => {
      this.buffer.push(chunk);
      for (const h of this.dataHandlers) h(chunk);
    });

    this.child.onExit(({ exitCode, signal }) => {
      this.alive = false;
      const info = { code: exitCode, signal: signal != null ? String(signal) : undefined };
      for (const h of this.exitHandlers) h(info);
    });
  }

  onData(handler: DataHandler): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }

  write(data: string): void {
    if (!this.alive) return;
    this.child.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    this.child.resize(cols, rows);
  }

  kill(): void {
    if (!this.alive) return;
    this.child.kill();
  }

  scrollback(): string[] {
    return this.buffer.replay();
  }

  isAlive(): boolean {
    return this.alive;
  }
}
```

- [ ] **Step 4: Run, watch pass**

```bash
npm run test:extension
```

Expected: all three `PtyWorker` tests pass. (These spawn real `/bin/sh` processes — should still take less than a second total.)

- [ ] **Step 5: Commit**

```bash
git add src/pty/ptyWorker.ts src/pty/__tests__/ptyWorker.test.ts
git commit -m "feat(pty): PtyWorker — node-pty wrapper with bounded scrollback"
```

---

## Task 10: Add `ptyBacked` flag to `AgentState`

**Files:**

- Modify: `src/types.ts`
- Modify: `src/agentManager.ts`
- Modify: `src/fileWatcher.ts`

The flag is `false` everywhere in this plan; it will flip to `true` only in the follow-up plan that wires xterm.js.

- [ ] **Step 1: Add the field to `AgentState`**

In `src/types.ts`, in the `AgentState` interface, add immediately after `awaitingSince`:

```ts
  /** When true, this agent's terminal is backed by a node-pty worker (see PtyManager)
   *  and routes I/O through the webview xterm.js pane. When false (current default),
   *  the agent uses `vscode.window.createTerminal` (legacy). Gates the pty pipeline
   *  during rollout; removed once xterm.js integration is stable. */
  ptyBacked?: boolean;
```

- [ ] **Step 2: Initialise the field in every `AgentState` constructor site**

Run:

```bash
grep -n "hadToolsInTurn: false," src/agentManager.ts src/fileWatcher.ts
```

For every location returned, add `ptyBacked: false,` on the line immediately after `awaitingSince: null,`. (There are six call sites total.) Example:

```ts
hadToolsInTurn: false,
awaitingSince: null,
ptyBacked: false,
```

- [ ] **Step 3: Type-check**

```bash
npx tsc -b --noEmit
```

Expected: clean.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agentManager.ts src/fileWatcher.ts
git commit -m "feat(types): ptyBacked flag on AgentState (default false)"
```

---

## Task 11: PtyManager — per-agent orchestration

**Files:**

- Create: `src/pty/ptyManager.ts`
- Create: `src/pty/__tests__/ptyManager.test.ts`

`PtyManager` is the bridge between `MessageSource` / `MessageSink` and `PtyWorker`s. It:

- spawns a `PtyWorker` for an agent on `start(agentId, opts)`
- forwards pty output as `ptyData` messages to the sink (chunked to `PTY_MAX_CHUNK_BYTES`)
- emits `ptyExit` on worker exit
- replays scrollback on `terminalPaneReady` messages from any webview
- accepts `ptyInput` (writes to pty) and `ptyResize` (resizes pty)
- exposes `disposeAll()` for extension deactivate

- [ ] **Step 1: Write the failing tests**

Create `src/pty/__tests__/ptyManager.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PtyManager } from '../ptyManager.js';
import { isPtyInputMessage } from '../ptyProtocol.js';

interface MockSinkRecord {
  type: string;
  agentId?: number;
  data?: string;
  lines?: string[];
  code?: number;
  signal?: string;
}

function makeSink() {
  const messages: MockSinkRecord[] = [];
  return {
    sent: messages,
    postMessage: (msg: unknown): Thenable<boolean> => {
      messages.push(msg as MockSinkRecord);
      return Promise.resolve(true);
    },
  };
}

function makeSource() {
  type Handler = (m: Record<string, unknown>) => unknown;
  const handlers: Handler[] = [];
  return {
    handlers,
    onMessage(h: Handler) {
      handlers.push(h);
      return { dispose: () => {} };
    },
    emit(message: Record<string, unknown>) {
      for (const h of handlers) h(message);
    },
  };
}

describe('PtyManager', () => {
  it('starts a worker for an agent and forwards ptyData to the sink', async () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    manager.start(1, {
      shell: '/bin/sh',
      args: ['-c', "printf 'hello\\n'"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    // Wait for the process to exit (the manager emits ptyExit).
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (sink.sent.some((m) => m.type === 'ptyExit' && m.agentId === 1)) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    const dataMessages = sink.sent.filter((m) => m.type === 'ptyData' && m.agentId === 1);
    expect(dataMessages.length).toBeGreaterThan(0);
    expect(dataMessages.map((m) => m.data).join('')).toContain('hello');

    const exitMessage = sink.sent.find((m) => m.type === 'ptyExit' && m.agentId === 1);
    expect(exitMessage?.code).toBe(0);

    manager.disposeAll();
  });

  it('replays scrollback when terminalPaneReady arrives', async () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    manager.start(2, {
      shell: '/bin/sh',
      args: ['-c', "printf 'replay-content\\n'"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    // Wait for exit to ensure scrollback is fully populated.
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (sink.sent.some((m) => m.type === 'ptyExit' && m.agentId === 2)) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    // Webview signals it just mounted — manager should replay scrollback.
    source.emit({ type: 'terminalPaneReady', agentId: 2 });

    const replayMessage = sink.sent.find((m) => m.type === 'ptyScrollback' && m.agentId === 2);
    expect(replayMessage).toBeDefined();
    expect((replayMessage?.lines ?? []).join('')).toContain('replay-content');

    manager.disposeAll();
  });

  it('routes ptyInput from source to worker stdin', async () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    manager.start(3, {
      shell: '/bin/sh',
      // Read one line of stdin and echo it back, then exit.
      args: ['-c', 'read line; printf "got:%s\\n" "$line"'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    // Send input via the protocol.
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 3, data: 'hello\n' })).toBe(true);
    source.emit({ type: 'ptyInput', agentId: 3, data: 'hello\n' });

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (sink.sent.some((m) => m.type === 'ptyExit' && m.agentId === 3)) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    const dataMessages = sink.sent
      .filter((m) => m.type === 'ptyData' && m.agentId === 3)
      .map((m) => m.data)
      .join('');
    expect(dataMessages).toContain('got:hello');

    manager.disposeAll();
  });

  it('disposeAll() kills active workers', () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    manager.start(4, {
      shell: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    expect(manager.has(4)).toBe(true);
    manager.disposeAll();
    expect(manager.has(4)).toBe(false);
  });

  it('ignores ptyInput / ptyResize for unknown agentIds', () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    // No worker started for agent 999.
    expect(() => source.emit({ type: 'ptyInput', agentId: 999, data: 'x' })).not.toThrow();
    expect(() =>
      source.emit({ type: 'ptyResize', agentId: 999, cols: 80, rows: 24 }),
    ).not.toThrow();
    // No data messages should have been emitted.
    expect(sink.sent.filter((m) => m.agentId === 999).length).toBe(0);

    manager.disposeAll();
  });
});
```

- [ ] **Step 2: Run, watch fail**

```bash
npm run test:extension
```

Expected: FAIL — `PtyManager` not defined.

- [ ] **Step 3: Implement**

Create `src/pty/ptyManager.ts`:

```ts
import { PTY_MAX_CHUNK_BYTES } from '../../server/src/constants.js';
import type { MessageSink, MessageSource } from '../types.js';
import {
  isPtyInputMessage,
  isPtyResizeMessage,
  isTerminalPaneReadyMessage,
} from './ptyProtocol.js';
import type { PtyWorkerOptions } from './ptyWorker.js';
import { PtyWorker } from './ptyWorker.js';

interface PtyManagerOptions {
  sink: MessageSink;
  source: MessageSource;
  /** Optional override for the constructor used to spawn a worker — exposed
   *  for tests so they can pass a fake; defaults to PtyWorker. */
  workerFactory?: (opts: PtyWorkerOptions) => PtyWorker;
}

export interface PtyStartOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  /** Per-agent scrollback cap. Defaults to PTY_SCROLLBACK_MAX_LINES at call sites. */
  scrollbackCapacity?: number;
}

const DEFAULT_SCROLLBACK = 2000;

/**
 * Bridges PtyWorkers to the extension's existing MessageSink/MessageSource
 * abstractions. The provider holds one PtyManager; each pty-backed agent has
 * exactly one PtyWorker registered here.
 *
 * Wire protocol consumed:
 *   inbound  — ptyInput, ptyResize, terminalPaneReady
 *   outbound — ptyData, ptyExit, ptyScrollback
 */
export class PtyManager {
  private readonly workers = new Map<number, PtyWorker>();
  private readonly subscription: { dispose(): void };
  private readonly factory: (opts: PtyWorkerOptions) => PtyWorker;

  constructor(private readonly opts: PtyManagerOptions) {
    this.factory = opts.workerFactory ?? ((o) => new PtyWorker(o));
    this.subscription = opts.source.onMessage((m) => this.handleInbound(m));
  }

  start(agentId: number, startOpts: PtyStartOptions): void {
    if (this.workers.has(agentId)) {
      // Idempotent: if already started, leave existing worker in place.
      return;
    }

    const worker = this.factory({
      shell: startOpts.shell,
      args: startOpts.args,
      cwd: startOpts.cwd,
      env: startOpts.env,
      cols: startOpts.cols,
      rows: startOpts.rows,
      scrollbackCapacity: startOpts.scrollbackCapacity ?? DEFAULT_SCROLLBACK,
    });

    worker.onData((chunk) => this.emitData(agentId, chunk));
    worker.onExit(({ code, signal }) => {
      this.workers.delete(agentId);
      void this.opts.sink.postMessage({ type: 'ptyExit', agentId, code, signal });
    });

    this.workers.set(agentId, worker);
  }

  has(agentId: number): boolean {
    return this.workers.has(agentId);
  }

  stop(agentId: number): void {
    const w = this.workers.get(agentId);
    if (!w) return;
    w.kill();
  }

  disposeAll(): void {
    for (const w of this.workers.values()) {
      try {
        w.kill();
      } catch {
        // best effort
      }
    }
    this.workers.clear();
    this.subscription.dispose();
  }

  private emitData(agentId: number, chunk: string): void {
    if (Buffer.byteLength(chunk, 'utf8') <= PTY_MAX_CHUNK_BYTES) {
      void this.opts.sink.postMessage({ type: 'ptyData', agentId, data: chunk });
      return;
    }
    // Pathological single write — split at the cap boundary.
    let remaining = chunk;
    while (Buffer.byteLength(remaining, 'utf8') > PTY_MAX_CHUNK_BYTES) {
      // Slice by code points first; conservative.
      const half = Math.floor(remaining.length / 2);
      const head = remaining.slice(0, half);
      remaining = remaining.slice(half);
      void this.opts.sink.postMessage({ type: 'ptyData', agentId, data: head });
    }
    void this.opts.sink.postMessage({ type: 'ptyData', agentId, data: remaining });
  }

  private handleInbound(message: Record<string, unknown>): void {
    if (isPtyInputMessage(message)) {
      const w = this.workers.get(message.agentId);
      w?.write(message.data);
      return;
    }
    if (isPtyResizeMessage(message)) {
      const w = this.workers.get(message.agentId);
      w?.resize(message.cols, message.rows);
      return;
    }
    if (isTerminalPaneReadyMessage(message)) {
      const w = this.workers.get(message.agentId);
      if (!w) return;
      void this.opts.sink.postMessage({
        type: 'ptyScrollback',
        agentId: message.agentId,
        lines: w.scrollback(),
      });
      return;
    }
    // All other messages are someone else's responsibility.
  }
}
```

- [ ] **Step 4: Run, watch pass**

```bash
npm run test:extension
```

Expected: all five `PtyManager` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pty/ptyManager.ts src/pty/__tests__/ptyManager.test.ts
git commit -m "feat(pty): PtyManager — per-agent pty orchestration with protocol bridge"
```

---

## Task 12: Wire `PtyManager` into the provider

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts`

The manager is instantiated once. Inbound pty messages route through `MessageSource` (the same one we wired in Task 4) — but the manager registers its own handler, which means the existing `handleWebviewMessage` dispatch and the new manager dispatch BOTH see every inbound message. That's fine: the manager only acts on the three pty message types, and `handleWebviewMessage` already ignores unknown types.

- [ ] **Step 1: Add import**

In `src/PixelAgentsViewProvider.ts`, add to the imports:

```ts
import { PtyManager } from './pty/ptyManager.js';
```

- [ ] **Step 2: Add field**

Inside the `PixelAgentsViewProvider` class, near other private fields (e.g. `private pixelAgentsServer: PixelAgentsServer | null = null;`), add:

```ts
private ptyManager: PtyManager | null = null;
```

- [ ] **Step 3: Construct on first webview**

The `MessageSource` for the manager has to fan messages from BOTH webviews. To keep things simple, the manager subscribes to **each** webview's source as it's resolved. Since the manager only forwards pty-shaped messages, double-subscription means an inbound `ptyInput` arriving on one webview reaches the manager once per webview — but `start()`/`write()` are idempotent for the active worker.

Wait — the manager's subscription is to a single `MessageSource`. We need a multi-source design or a single broadcast source.

**Simpler design: lazy-init the manager on the first webview, and register additional webviews' sources to the same manager via a small helper.**

Update `PtyManager` to accept additional sources after construction. (This was deliberately left out of Task 11 to keep that task tight; we add it here.)

In `src/pty/ptyManager.ts`, **add this method** to the `PtyManager` class (between `disposeAll` and `emitData`):

```ts
  /** Attach an additional inbound source (e.g. a newly-opened webview). The manager
   *  will forward pty-shaped messages from this source to the existing workers,
   *  in addition to messages from any sources already attached. */
  attachSource(source: MessageSource): { dispose(): void } {
    return source.onMessage((m) => this.handleInbound(m));
  }
```

The constructor's own subscription already routes its source — `attachSource` is for additional ones.

- [ ] **Step 4: Wire in the provider**

In `src/PixelAgentsViewProvider.ts`:

```ts
// Helper used by both webview-init sites.
private ensurePtyManager(initialSource: MessageSource): void {
  if (!this.ptyManager) {
    this.ptyManager = new PtyManager({
      sink: this.broadcastSink,
      source: initialSource,
    });
  } else {
    this.ptyManager.attachSource(initialSource);
  }
}
```

Place this method right after the `broadcastSink` field initialiser.

Then in `resolveWebviewView`, immediately AFTER the existing `webviewMessageSource(...).onMessage(...)` call, add:

```ts
this.ensurePtyManager(webviewMessageSource(webviewView.webview));
```

And in `openFullScreenPanel`, immediately AFTER the equivalent call there, add:

```ts
this.ensurePtyManager(webviewMessageSource(panel.webview));
```

Note: yes, this creates two adapters per webview — one for `handleWebviewMessage` routing, one for the pty manager. That's intentional: the two paths are completely independent and both layers just call `webview.onDidReceiveMessage` under the hood. The overhead is negligible.

- [ ] **Step 5: Dispose on extension deactivate**

Find the existing `dispose` / cleanup hook in the provider (search for `dispose` or `deactivate`). The provider has a `dispose()` method or similar — if so, add:

```ts
this.ptyManager?.disposeAll();
this.ptyManager = null;
```

If no such hook exists yet (i.e. there's no provider-level cleanup), add a method:

```ts
dispose(): void {
  this.ptyManager?.disposeAll();
  this.ptyManager = null;
  // Future cleanup goes here too.
}
```

…and ensure `extension.ts`'s `deactivate()` calls `provider.dispose()`. Check `src/extension.ts`:

```bash
grep -n "deactivate\|provider\.dispose\|PixelAgentsViewProvider" src/extension.ts | head -20
```

If `deactivate()` doesn't already call `provider.dispose()`, add it.

- [ ] **Step 6: Type-check + lint**

```bash
npx tsc -b --noEmit
npm run lint
```

If lint complains, run `npm run lint -- --fix`.

- [ ] **Step 7: Full test run**

```bash
npm test
```

Expected: all tests pass. New count: ~150 (the pty tests added).

- [ ] **Step 8: Production build sanity**

```bash
npm run package
```

Expected: builds without error.

- [ ] **Step 9: Commit**

```bash
git add src/PixelAgentsViewProvider.ts src/pty/ptyManager.ts
git commit -m "feat(provider): wire PtyManager — bridges webviews <-> pty workers"
```

---

## Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite passes**

```bash
npm test
```

Expected: 137 (existing) + ~22 new (4 messageSource + 6 RingBuffer + 5 ptyProtocol + 3 PtyWorker + ~5 PtyManager — adjust to actual count) ≈ 160 tests, zero failures.

- [ ] **Step 2: Lint clean**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Production build clean**

```bash
npm run package
```

Expected: no errors. Produces the same `dist/` shape as before.

- [ ] **Step 4: Sanity check — no consumer of `ptyBacked === true` exists yet**

```bash
grep -rn "ptyBacked" src/ webview-ui/src/
```

Expected: hits only in `types.ts`, `agentManager.ts`, `fileWatcher.ts` (initialiser), and any spec docs. No code branches yet on `ptyBacked === true` — that's the follow-up plan's job.

- [ ] **Step 5: F5 dev-host smoke (manual, optional but recommended)**

Open the repo in VS Code, press F5. The Extension Development Host should boot normally. Open the Pixel Agents side panel. Click `+ Agent` — terminal opens in VS Code's native strip (unchanged). The pty pipeline is wired but no agent is configured to use it.

If the dev host boots and the office UI looks identical to the pre-D1 build, the refactor + new modules are in place without regression.

- [ ] **Step 6: Merge to main**

```bash
git checkout main
git pull --ff-only
git merge --ff-only feature/phase-2-backend-pty
git log --oneline -10
git branch -d feature/phase-2-backend-pty
```

Confirm `main` advances by ~10 commits (one per task).

---

## Out of scope (next plans)

- Replace `TerminalPaneStub` with a real `TerminalPane` that subscribes to `ptyData` / `ptyExit` / `ptyScrollback`, sends `ptyInput` / `ptyResize` / `terminalPaneReady`, and renders xterm.js. Needs xterm.js + fit-addon installed in the webview, plus styling work.
- Per-agent `ptyBacked: true` opt-in (UI control or settings flag).
- Per-platform shell defaults (Windows ConPTY path through node-pty, default shell discovery on macOS/Linux).
- Copy/paste integration.
- Sound on `ptyExit` (mirrors the existing waiting chime, but for crashes/exits).

---

## Self-Review Checklist

- [ ] **Spec coverage:** D1 (MessageSource) — Tasks 1–4. D2 (node-pty + protocol + scrollback) — Tasks 5–12. Both done.
- [ ] **No placeholders:** Every step has concrete code or commands. No "TBD" or "similar to above".
- [ ] **Type consistency:** `MessageSource` returns `vscode.Disposable` in `types.ts`, Task 2's mock matches that shape (returns `{ dispose }`). `PtyWorker` constructor signature matches the one consumed by `PtyManager` and the tests. `PtyManager.attachSource` returns the same disposable shape as `onMessage`.
- [ ] **TDD discipline:** Every new module (`messageSource`, `RingBuffer`, `PtyWorker`, `PtyManager`, `ptyProtocol`) has tests written BEFORE the implementation. Wire-up tasks (Task 4, Task 12) don't have unit tests but rely on the existing suite + production build to confirm regressions.
- [ ] **Frequent commits:** Each task ends in a commit. Ten total commits on the branch.
- [ ] **Behavioural change:** Zero. `ptyBacked` defaults to `false` everywhere; no agent uses the pty pipeline until the follow-up plan flips that flag.
