# xterm.js Terminal Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `TerminalPaneStub` with a real xterm.js terminal that consumes the pty protocol shipped in the previous plan, and add an opt-in "Use in-panel terminal (experimental)" setting that flips `launchNewTerminal` to spawn pty-backed agents through `PtyManager`. After this plan, the user can toggle the setting on, click `+ Agent`, and have Claude run **inside the office panel** instead of the VS Code terminal strip.

**Architecture:** Webview installs `@xterm/xterm` + `@xterm/addon-fit`. A `PtyEventBus` (pure module) routes incoming `ptyData` / `ptyExit` / `ptyScrollback` messages — which `useExtensionMessages` already receives — to per-agent subscribers via an emitter pattern. The new `TerminalPane.tsx` mounts one xterm.js instance per agent, subscribes via the bus, sends `ptyInput` / `ptyResize` / `terminalPaneReady` through `vscode.postMessage`, and renders alongside the existing stub (`OfficePanel` chooses one or the other based on the agent's `ptyBacked` flag). On the extension side, a new `GLOBAL_KEY_USE_PTY_TERMINAL` flag controls whether `launchNewTerminal` spawns a `vscode.window.createTerminal` (legacy) or calls `PtyManager.start(...)` with the same `claude --session-id <uuid>` command line (new). `ptyBacked: true` is set on the agent in the pty path; everywhere else the flag stays `false`. Restored agents remain legacy on extension reload (pty-backed sessions are runtime-only in v1; documented limitation).

**Tech Stack:** `@xterm/xterm` 5.x + `@xterm/addon-fit` (the new scoped packages — the unscoped `xterm` / `xterm-addon-fit` are still published but the scoped names are the canonical home as of 2024+). React 19. Existing Vitest + node:test harnesses. No new tooling.

**Parent specs:**

- `docs/ROADMAP.md` — Phase 3 architectural intent (transport-agnostic everywhere). (Formerly `docs/superpowers/specs/2026-04-21-remote-office-vision.md`.)
- `docs/superpowers/specs/2026-04-21-phase-2-drawer-ux-design.md` — drawer + panel UX, "Replace `TerminalPaneStub` with a real `TerminalPane`" is in Implementation Order step 2 (D1 + D2 prereqs were the last plan).

---

## Preconditions

- Branch off current `main` as `feature/xterm-terminal-pane`.
- `main` already has D1+D2 landed (`a71e2dc`). 201 tests pass. `PtyManager` + `node-pty` work end-to-end (verified by activation check + integration tests).
- `ptyBacked` flag exists on `AgentState`, defaults `false`, no consumer branches on it yet — that's what this plan changes.

---

## Known limitations (v1, documented; NOT bugs to fix)

1. **Reload drops pty terminals.** On extension reload, `restoreAgents` recreates legacy `vscode.window.createTerminal` agents only. Pty-backed sessions are runtime-only. The user can manually `+ Agent` again to spawn a new pty terminal (the underlying Claude session is still recoverable via `--resume`, but v1 doesn't auto-resume).
2. **No copy/paste integration.** xterm.js's default `Cmd+C` / `Cmd+V` behavior applies inside the pane; selection-to-clipboard works, but no integration with VS Code's clipboard commands. Parent spec carries copy/paste as an open question — defer.
3. **Windows behavior unverified.** `node-pty` uses ConPTY on Windows, which has rougher edges around ANSI handling. Manual smoke testing on Windows is **out of scope** for v1; we ship behind an experimental toggle so Windows users can opt out if behavior is off.
4. **One terminal per agent.** Switching the panel's focused agent shows that agent's pre-mounted `TerminalPane` (via `display: none` toggle, not unmount). No tabbed multi-terminal-per-agent.

---

## File Structure

**New files:**

| File                                           | Responsibility                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/src/office/panel/ptyEventBus.ts`   | Pure event emitter: `subscribe(agentId, event, handler)` + `emit(event, agentId, payload)`. Decouples xterm.js renderers from the global `useExtensionMessages` message stream.                    |
| `webview-ui/test/pty-event-bus.test.ts`        | Unit tests for the bus (subscribe, emit, unsubscribe, multi-subscriber, unknown-agent emit is a no-op).                                                                                            |
| `webview-ui/src/office/panel/TerminalPane.tsx` | Real xterm.js-backed terminal pane. Mounts one `Terminal` + `FitAddon` per agent. Subscribes to `ptyData`/`ptyExit`/`ptyScrollback` via the bus. Posts `ptyInput`/`ptyResize`/`terminalPaneReady`. |

**Modified files:**

| File                                                      | Change                                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-ui/package.json`                                 | Add `@xterm/xterm` + `@xterm/addon-fit` runtime deps.                                                                                                                                   |
| `webview-ui/src/hooks/useExtensionMessages.ts`            | When `ptyData` / `ptyExit` / `ptyScrollback` messages arrive, route them through the bus instead of (or in addition to) React state.                                                    |
| `webview-ui/src/office/panel/OfficePanel.tsx`             | Render the real `TerminalPane` when the focused agent's `ptyBacked === true`; keep `TerminalPaneStub` for legacy agents.                                                                |
| `src/constants.ts`                                        | New `GLOBAL_KEY_USE_PTY_TERMINAL` key.                                                                                                                                                  |
| `src/PixelAgentsViewProvider.ts`                          | Load the new setting, include in `settingsLoaded` payload, handle `setUsePtyTerminal` messages, pass the flag through to `launchNewTerminal` callers.                                   |
| `webview-ui/src/components/SettingsModal.tsx`             | New checkbox: "Use in-panel terminal (experimental)".                                                                                                                                   |
| `webview-ui/src/hooks/useExtensionMessages.ts`            | Add `usePtyTerminal` + `setUsePtyTerminal` to the returned state shape.                                                                                                                 |
| `src/agentManager.ts`                                     | `launchNewTerminal` accepts a new `usePtyTerminal` boolean. When true, spawn via `PtyManager.start(...)` instead of `vscode.window.createTerminal`, set `ptyBacked: true` on the agent. |
| `webview-ui/vite.config.ts` (if present, or `index.html`) | Verify xterm.js CSS is loaded — `import '@xterm/xterm/css/xterm.css'` in the entry.                                                                                                     |

**Out of scope:**

- Webview test harness for React components (xterm.js needs a real DOM and a Canvas/WebGL renderer; JSDOM doesn't suffice; Playwright-component-testing is overkill for one component). Manual smoke is the gate.
- Resume-on-reload for pty agents.
- Copy/paste, Windows hardening.

---

## Task 1: Branch + install xterm.js

**Files:**

- Modify: `webview-ui/package.json`
- Modify: `webview-ui/package-lock.json`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/angel/Desktop/pixel-agents
git checkout main
git pull --ff-only
git checkout -b feature/xterm-terminal-pane
git status   # expect clean
```

- [ ] **Step 2: Install xterm + fit addon (scoped packages)**

```bash
cd webview-ui
npm install @xterm/xterm @xterm/addon-fit
```

Both should land as `dependencies`, not `devDependencies` (they're bundled by Vite into the webview).

- [ ] **Step 3: Verify import resolves**

```bash
node -e "const x=require.resolve('@xterm/xterm'); console.log(x)"
```

Expected: a path under `node_modules/@xterm/xterm`. If it errors with "module not found", check `webview-ui/package.json` lists both packages.

- [ ] **Step 4: Build the webview to ensure no Vite errors**

```bash
npm run build
```

Expected: the existing webview build succeeds (no consumer of xterm.js yet, so the dep is added but unused — Vite tree-shakes it out of the bundle).

- [ ] **Step 5: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/package.json webview-ui/package-lock.json
git commit -m "chore(deps): add @xterm/xterm + @xterm/addon-fit (webview)"
```

---

## Task 2: PtyEventBus (TDD)

**Files:**

- Create: `webview-ui/src/office/panel/ptyEventBus.ts`
- Create: `webview-ui/test/pty-event-bus.test.ts`

Why a bus? Multiple `TerminalPane` instances (one per agent) need to react imperatively to incoming pty messages — calling `terminal.write(chunk)` on xterm.js. React state updates don't compose well with xterm.js's imperative API (forcing re-renders on every keystroke would thrash). A small per-agent event emitter keeps the wiring clean: `useExtensionMessages` emits, `TerminalPane` subscribes.

- [ ] **Step 1: Write the failing tests**

Create `webview-ui/test/pty-event-bus.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PtyEventBus } from '../src/office/panel/ptyEventBus.ts';

test('PtyEventBus: emit/subscribe round-trip for ptyData', () => {
  const bus = new PtyEventBus();
  const received: string[] = [];
  bus.subscribe(5, 'ptyData', (data) => received.push(data));
  bus.emitData(5, 'hello');
  bus.emitData(5, 'world');
  assert.deepEqual(received, ['hello', 'world']);
});

test('PtyEventBus: subscriber for one agent does not receive another agent’s events', () => {
  const bus = new PtyEventBus();
  const a: string[] = [];
  const b: string[] = [];
  bus.subscribe(1, 'ptyData', (data) => a.push(data));
  bus.subscribe(2, 'ptyData', (data) => b.push(data));
  bus.emitData(1, 'for-1');
  bus.emitData(2, 'for-2');
  assert.deepEqual(a, ['for-1']);
  assert.deepEqual(b, ['for-2']);
});

test('PtyEventBus: subscribe returns dispose that detaches handler', () => {
  const bus = new PtyEventBus();
  const received: string[] = [];
  const sub = bus.subscribe(7, 'ptyData', (data) => received.push(data));
  bus.emitData(7, 'before');
  sub.dispose();
  bus.emitData(7, 'after');
  assert.deepEqual(received, ['before']);
});

test('PtyEventBus: multiple subscribers for same agent all receive events', () => {
  const bus = new PtyEventBus();
  const x: string[] = [];
  const y: string[] = [];
  bus.subscribe(3, 'ptyData', (d) => x.push(d));
  bus.subscribe(3, 'ptyData', (d) => y.push(d));
  bus.emitData(3, 'fanout');
  assert.deepEqual(x, ['fanout']);
  assert.deepEqual(y, ['fanout']);
});

test('PtyEventBus: emit to unknown agent is a no-op (no throw)', () => {
  const bus = new PtyEventBus();
  assert.doesNotThrow(() => bus.emitData(999, 'ignored'));
});

test('PtyEventBus: ptyExit event has its own subscriber list', () => {
  const bus = new PtyEventBus();
  const dataEvents: string[] = [];
  const exitEvents: Array<{ code: number; signal?: string }> = [];
  bus.subscribe(4, 'ptyData', (d) => dataEvents.push(d));
  bus.subscribe(4, 'ptyExit', (e) => exitEvents.push(e));
  bus.emitData(4, 'still alive');
  bus.emitExit(4, { code: 0 });
  assert.deepEqual(dataEvents, ['still alive']);
  assert.deepEqual(exitEvents, [{ code: 0 }]);
});

test('PtyEventBus: ptyScrollback event carries an array of lines', () => {
  const bus = new PtyEventBus();
  const received: string[][] = [];
  bus.subscribe(8, 'ptyScrollback', (lines) => received.push(lines));
  bus.emitScrollback(8, ['line1', 'line2']);
  assert.deepEqual(received, [['line1', 'line2']]);
});
```

- [ ] **Step 2: Run tests, watch fail**

```bash
cd webview-ui
npm test
```

Expected: existing 40 webview tests pass; the new `pty-event-bus.test.ts` tests fail with "module not found" or similar.

- [ ] **Step 3: Implement PtyEventBus**

Create `webview-ui/src/office/panel/ptyEventBus.ts`:

```ts
type DataHandler = (data: string) => void;
type ExitHandler = (info: { code: number; signal?: string }) => void;
type ScrollbackHandler = (lines: string[]) => void;

interface AgentSubscribers {
  ptyData: Set<DataHandler>;
  ptyExit: Set<ExitHandler>;
  ptyScrollback: Set<ScrollbackHandler>;
}

type Handler<E extends keyof AgentSubscribers> = E extends 'ptyData'
  ? DataHandler
  : E extends 'ptyExit'
    ? ExitHandler
    : ScrollbackHandler;

/**
 * Per-agent event router for pty wire messages. xterm.js renderers subscribe
 * imperatively for an agentId; useExtensionMessages emits as messages arrive.
 * Keeps React state out of the per-keystroke render path.
 */
export class PtyEventBus {
  private agents = new Map<number, AgentSubscribers>();

  private slot(agentId: number): AgentSubscribers {
    let s = this.agents.get(agentId);
    if (!s) {
      s = {
        ptyData: new Set(),
        ptyExit: new Set(),
        ptyScrollback: new Set(),
      };
      this.agents.set(agentId, s);
    }
    return s;
  }

  subscribe<E extends keyof AgentSubscribers>(
    agentId: number,
    event: E,
    handler: Handler<E>,
  ): { dispose(): void } {
    const set = this.slot(agentId)[event] as Set<Handler<E>>;
    set.add(handler);
    return {
      dispose: () => {
        set.delete(handler);
      },
    };
  }

  emitData(agentId: number, data: string): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyData) h(data);
  }

  emitExit(agentId: number, info: { code: number; signal?: string }): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyExit) h(info);
  }

  emitScrollback(agentId: number, lines: string[]): void {
    const s = this.agents.get(agentId);
    if (!s) return;
    for (const h of s.ptyScrollback) h(lines);
  }
}
```

- [ ] **Step 4: Run tests, watch pass**

```bash
npm test
```

Expected: 47 webview tests passing (40 + 7 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/src/office/panel/ptyEventBus.ts webview-ui/test/pty-event-bus.test.ts
git commit -m "feat(panel): PtyEventBus — per-agent imperative event router for xterm.js"
```

---

## Task 3: Hook PtyEventBus into useExtensionMessages

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`

The hook today is the single point that receives all webview-bound messages. Add a stable `PtyEventBus` instance and route `ptyData` / `ptyExit` / `ptyScrollback` messages through it. Expose the bus via the hook's return value so `OfficePanel` / `TerminalPane` can subscribe.

- [ ] **Step 1: Add the bus import + instance**

At the top of `webview-ui/src/hooks/useExtensionMessages.ts`, add to the imports:

```ts
import { PtyEventBus } from '../office/panel/ptyEventBus.js';
```

Inside the `useExtensionMessages` function, BEFORE the `useEffect` that adds the `message` listener, add a stable bus ref:

```ts
const ptyEventBusRef = useRef<PtyEventBus>(new PtyEventBus());
```

(Add `useRef` to the existing `react` import if not already present.)

- [ ] **Step 2: Route pty messages through the bus**

Find the existing `window.addEventListener('message', handler, ...)` block (the big `else if` chain). After the existing branches (the chain ends near the `setStatuses` / `setSubagentTools` handling), add:

```ts
} else if (msg.type === 'ptyData') {
  const id = msg.id as number;
  const data = msg.data as string;
  ptyEventBusRef.current.emitData(id, data);
} else if (msg.type === 'ptyExit') {
  const id = msg.id as number;
  const code = msg.code as number;
  const signal = typeof msg.signal === 'string' ? msg.signal : undefined;
  ptyEventBusRef.current.emitExit(id, { code, signal });
} else if (msg.type === 'ptyScrollback') {
  const id = msg.id as number;
  const lines = Array.isArray(msg.lines) ? (msg.lines as string[]) : [];
  ptyEventBusRef.current.emitScrollback(id, lines);
}
```

Note: the extension sends pty messages with `agentId` in `PtyManager.emitData`/`postMessage` calls (see `src/pty/ptyManager.ts`). Match the field name. Look at `ptyManager.ts:80` — it posts `{ type: 'ptyData', agentId, data }`. So **use `msg.agentId` not `msg.id`** in the handlers above. Update the three handlers accordingly:

```ts
} else if (msg.type === 'ptyData') {
  const id = msg.agentId as number;
  // ...
```

- [ ] **Step 3: Add `ptyEventBus` to the hook's return type**

Add to the `ExtensionMessageState` interface:

```ts
ptyEventBus: PtyEventBus;
```

And to the return object at the bottom of `useExtensionMessages`:

```ts
return {
  // ... existing fields ...
  ptyEventBus: ptyEventBusRef.current,
};
```

- [ ] **Step 4: Build + test**

```bash
cd webview-ui
npm run build
npm test
```

Expected: build clean. Tests still pass (47 webview total).

- [ ] **Step 5: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "feat(panel): route pty wire messages through PtyEventBus in useExtensionMessages"
```

---

## Task 4: TerminalPane component

**Files:**

- Create: `webview-ui/src/office/panel/TerminalPane.tsx`

The pane mounts one xterm.js `Terminal` + `FitAddon` per agent. It subscribes to the bus for `ptyData` / `ptyExit` / `ptyScrollback`, forwards keystrokes via `vscode.postMessage({ type: 'ptyInput', agentId, data })`, calls `fit()` on container resize and posts the resulting `ptyResize`, and emits `terminalPaneReady` once on mount so the extension replays scrollback.

- [ ] **Step 1: Add xterm.js CSS to the webview entry**

xterm.js requires its stylesheet to render correctly. Open `webview-ui/src/main.tsx` (or `webview-ui/src/index.tsx` — whichever is the entry). At the top of the file, add:

```ts
import '@xterm/xterm/css/xterm.css';
```

Place this with the other CSS imports (e.g. `./index.css`). Order: xterm.css first, then `./index.css` (so the project's pixel-art overrides win on conflicts).

- [ ] **Step 2: Create `TerminalPane.tsx`**

Write to `webview-ui/src/office/panel/TerminalPane.tsx`:

```tsx
import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { PANEL_BG_CHROME } from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import type { PtyEventBus } from './ptyEventBus.js';

interface TerminalPaneProps {
  agentId: number;
  agentName: string | null;
  fontSize: number;
  bus: PtyEventBus;
}

export function TerminalPane({ agentId, agentName, fontSize, bus }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // One-time setup per agentId: create the xterm.js Terminal + addon, attach to DOM.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: PANEL_BG_CHROME,
      },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + send dimensions to the extension so the pty matches.
    try {
      fit.fit();
    } catch {
      // open() races with first layout; ignore and let the ResizeObserver catch up.
    }
    const cols = term.cols;
    const rows = term.rows;
    vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });

    // Subscribe to bus events.
    const dataSub = bus.subscribe(agentId, 'ptyData', (chunk) => {
      term.write(chunk);
    });
    const exitSub = bus.subscribe(agentId, 'ptyExit', ({ code, signal }) => {
      const msg = signal
        ? `\r\n[pty exited: signal ${signal}]\r\n`
        : `\r\n[pty exited: code ${code}]\r\n`;
      term.write(msg);
    });
    const scrollbackSub = bus.subscribe(agentId, 'ptyScrollback', (lines) => {
      for (const line of lines) term.write(line);
    });

    // Keystrokes → ptyInput.
    const keyDisposable = term.onData((data) => {
      vscode.postMessage({ type: 'ptyInput', agentId, data });
    });

    // Resize observer → fit + ptyResize.
    let lastCols = cols;
    let lastRows = rows;
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        return;
      }
      const c = termRef.current.cols;
      const r = termRef.current.rows;
      if (c !== lastCols || r !== lastRows) {
        lastCols = c;
        lastRows = r;
        vscode.postMessage({ type: 'ptyResize', agentId, cols: c, rows: r });
      }
    });
    ro.observe(el);

    // Signal ready so the extension replays scrollback.
    vscode.postMessage({ type: 'terminalPaneReady', agentId });

    return () => {
      dataSub.dispose();
      exitSub.dispose();
      scrollbackSub.dispose();
      keyDisposable.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The bus is stable (ref'd in useExtensionMessages); fontSize changes are
    // handled by a separate effect below to avoid re-creating the terminal.
    // agentName is presentational only; doesn't change the underlying terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, bus]);

  // Apply font-size changes without recreating the terminal.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    try {
      fit.fit();
    } catch {
      return;
    }
    const cols = term.cols;
    const rows = term.rows;
    vscode.postMessage({ type: 'ptyResize', agentId, cols, rows });
  }, [fontSize, agentId]);

  return (
    <div
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        background: PANEL_BG_CHROME,
        padding: 4,
      }}
      aria-label={agentName ? `Terminal for ${agentName}` : 'Terminal'}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm imports resolve**

```bash
cd webview-ui
npm run build
```

Expected: clean. Bundle size grows by ~300-600 KB (xterm + addon).

- [ ] **Step 4: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/src/main.tsx webview-ui/src/office/panel/TerminalPane.tsx
git commit -m "feat(panel): TerminalPane — xterm.js render + pty protocol wiring"
```

If the entry file is `index.tsx` instead of `main.tsx`, adjust the `git add` path. Confirm with `ls webview-ui/src/main.tsx webview-ui/src/index.tsx` before committing.

---

## Task 5: Wire `TerminalPane` into `OfficePanel`

**Files:**

- Modify: `webview-ui/src/office/panel/OfficePanel.tsx`
- Modify: `webview-ui/src/App.tsx` (pass through `bus` and `agentsByPty`)

`OfficePanel` currently always renders `TerminalPaneStub`. Now it needs to choose: real `TerminalPane` when the focused agent is `ptyBacked`, stub otherwise. The `ptyBacked` flag lives on the extension-side `AgentState` and isn't currently sent to the webview — we'll forward it as part of the agent summary state.

- [ ] **Step 1: Track per-agent `ptyBacked` in `useExtensionMessages`**

Open `webview-ui/src/hooks/useExtensionMessages.ts`. The webview learns about agents via `agentCreated`/`existingAgents` messages from the extension. Look at how the existing code processes them (search for `agentCreated`). Add a parallel `ptyBackedByAgent: Record<number, boolean>` state:

```ts
const [ptyBackedByAgent, setPtyBackedByAgent] = useState<Record<number, boolean>>({});
```

When processing `agentCreated`, check `msg.ptyBacked === true` and update:

```ts
} else if (msg.type === 'agentCreated') {
  const id = msg.id as number;
  // ... existing logic ...
  if (msg.ptyBacked === true) {
    setPtyBackedByAgent((prev) => ({ ...prev, [id]: true }));
  }
}
```

When processing `existingAgents` (the restore-on-boot message), check each entry's `ptyBacked` flag the same way.

When processing `agentClosed`, also clean up:

```ts
} else if (msg.type === 'agentClosed') {
  const id = msg.id as number;
  // ... existing logic ...
  setPtyBackedByAgent((prev) => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
}
```

Add `ptyBackedByAgent` to the hook's `ExtensionMessageState` return type and include it in the returned object.

- [ ] **Step 2: Pass `ptyBacked` from the extension when announcing agents**

Open `src/PixelAgentsViewProvider.ts` and `src/agentManager.ts`. Find every place that posts `agentCreated` or `existingAgents` to the webview. Each agent payload needs to include `ptyBacked: agent.ptyBacked === true`. Grep for `'agentCreated'` and `'existingAgents'` to find call sites:

```bash
grep -rn "type: 'agentCreated'\|type: 'existingAgents'\|type: \"agentCreated\"\|type: \"existingAgents\"" src/ server/src/
```

At each, add `ptyBacked: agent.ptyBacked === true` to the payload.

- [ ] **Step 3: Pass bus + ptyBacked into `OfficePanel` from `App.tsx`**

Open `webview-ui/src/App.tsx`. The `OfficePanel` is rendered with props like `state={panel.state}`. Add new props:

```ts
ptyBackedByAgent = { ptyBackedByAgent };
ptyEventBus = { ptyEventBus };
```

Both come from the `useExtensionMessages` destructure.

- [ ] **Step 4: Update `OfficePanel` to branch on `ptyBacked`**

Open `webview-ui/src/office/panel/OfficePanel.tsx`. Add to the props interface:

```ts
ptyBackedByAgent: Record<number, boolean>;
ptyEventBus: PtyEventBus;
```

Add the import:

```ts
import type { PtyEventBus } from './ptyEventBus.js';
import { TerminalPane } from './TerminalPane.js';
```

Find the place inside the OPEN-mode return where `TerminalPaneStub` is rendered. Replace it with a conditional:

```tsx
{
  state.focusedAgentId !== null && ptyBackedByAgent[state.focusedAgentId] ? (
    <TerminalPane
      agentId={state.focusedAgentId}
      agentName={focused?.name ?? null}
      fontSize={state.terminalFontSize}
      bus={ptyEventBus}
    />
  ) : (
    <TerminalPaneStub
      agentId={state.focusedAgentId}
      agentName={focused?.name ?? null}
      fontSize={state.terminalFontSize}
    />
  );
}
```

`focused` is the `find` result already present in the file.

- [ ] **Step 5: Build + smoke**

```bash
cd webview-ui
npm run build
```

Expected: clean. No test changes needed yet — the React component path isn't unit-tested.

- [ ] **Step 6: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/App.tsx webview-ui/src/office/panel/OfficePanel.tsx src/PixelAgentsViewProvider.ts src/agentManager.ts
git commit -m "feat(panel): wire real TerminalPane for ptyBacked agents"
```

---

## Task 6: Extension setting — `usePtyTerminal` global flag

**Files:**

- Modify: `src/constants.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

- [ ] **Step 1: Add the constant**

Open `src/constants.ts`. Find the block with `GLOBAL_KEY_HOOKS_ENABLED` and similar keys. Add:

```ts
/** When true, new agents spawn inside the office panel via node-pty + xterm.js.
 *  When false (default), agents use vscode.window.createTerminal as before.
 *  Experimental — off until users opt in. */
export const GLOBAL_KEY_USE_PTY_TERMINAL = 'pixel-agents.usePtyTerminal';
```

- [ ] **Step 2: Add the field + setting load in `PixelAgentsViewProvider`**

Open `src/PixelAgentsViewProvider.ts`. Add `GLOBAL_KEY_USE_PTY_TERMINAL` to the existing constants import.

Add a field:

```ts
usePtyTerminal = { current: false };
```

(Placed near `hooksEnabled = { current: true };`.)

In whichever method loads other globalState settings at startup (search for `GLOBAL_KEY_HOOKS_ENABLED`), add:

```ts
this.usePtyTerminal.current = this.context.globalState.get<boolean>(
  GLOBAL_KEY_USE_PTY_TERMINAL,
  false,
);
```

- [ ] **Step 3: Send the setting to the webview in `settingsLoaded`**

Find the `settingsLoaded` message dispatch (search for `'settingsLoaded'`). Add `usePtyTerminal` to its payload:

```ts
this.broadcastSink.postMessage({
  type: 'settingsLoaded',
  // ... existing fields ...
  usePtyTerminal: this.usePtyTerminal.current,
});
```

- [ ] **Step 4: Handle the inbound setter message**

Find the `handleWebviewMessage` block (the `else if (message.type === 'setHooksEnabled')` chain). Add a parallel handler:

```ts
} else if (message.type === 'setUsePtyTerminal') {
  const enabled = !!message.enabled;
  this.context.globalState.update(GLOBAL_KEY_USE_PTY_TERMINAL, enabled);
  this.usePtyTerminal.current = enabled;
}
```

- [ ] **Step 5: Build + tests**

```bash
cd /Users/angel/Desktop/pixel-agents
npm run package
npm test
```

Expected: 201 tests still passing (no new tests in this task; smoke is verified later). Build clean.

- [ ] **Step 6: Commit**

```bash
git add src/constants.ts src/PixelAgentsViewProvider.ts
git commit -m "feat(settings): usePtyTerminal global flag (extension side)"
```

---

## Task 7: Webview state + SettingsModal toggle

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`
- Modify: `webview-ui/src/components/SettingsModal.tsx`
- Modify: `webview-ui/src/App.tsx`

- [ ] **Step 1: Read + setter in `useExtensionMessages`**

Open `webview-ui/src/hooks/useExtensionMessages.ts`. Add to the `ExtensionMessageState` interface:

```ts
usePtyTerminal: boolean;
setUsePtyTerminal: (v: boolean) => void;
```

Add state:

```ts
const [usePtyTerminal, setUsePtyTerminalState] = useState(false);
```

In the `settingsLoaded` handler (find `msg.type === 'settingsLoaded'`), pick up the new field:

```ts
if (typeof msg.usePtyTerminal === 'boolean') {
  setUsePtyTerminalState(msg.usePtyTerminal);
}
```

Add a setter function that posts the message:

```ts
const setUsePtyTerminal = useCallback((v: boolean) => {
  setUsePtyTerminalState(v);
  vscode.postMessage({ type: 'setUsePtyTerminal', enabled: v });
}, []);
```

Include both in the returned object.

- [ ] **Step 2: Add the toggle to `SettingsModal`**

Open `webview-ui/src/components/SettingsModal.tsx`. Find the existing "Instant Detection (Hooks)" checkbox (around line 122-126 — look for `Hook` or `hooksEnabled`). Add a sibling checkbox below it:

```tsx
<Checkbox
  label="Use in-panel terminal (experimental)"
  checked={usePtyTerminal}
  onChange={onToggleUsePtyTerminal}
/>
```

Add to props:

```ts
usePtyTerminal: boolean;
onToggleUsePtyTerminal: () => void;
```

And destructure them in the function signature.

- [ ] **Step 3: Wire props in App.tsx**

Open `webview-ui/src/App.tsx`. Destructure `usePtyTerminal` and `setUsePtyTerminal` from `useExtensionMessages`. Pass them through to `SettingsModal`:

```tsx
usePtyTerminal={usePtyTerminal}
onToggleUsePtyTerminal={() => setUsePtyTerminal(!usePtyTerminal)}
```

- [ ] **Step 4: Build**

```bash
cd webview-ui
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/angel/Desktop/pixel-agents
git add webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/components/SettingsModal.tsx webview-ui/src/App.tsx
git commit -m "feat(settings): usePtyTerminal toggle in SettingsModal"
```

---

## Task 8: Rewire `launchNewTerminal` to branch on `usePtyTerminal`

**Files:**

- Modify: `src/agentManager.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

When the user clicks `+ Agent` with the setting on, spawn through `PtyManager.start(...)` instead of `vscode.window.createTerminal`. Both paths still use the same `claude --session-id <uuid>` command line. The JSONL transcript still lands at `~/.claude/projects/<hash>/<sessionId>.jsonl` so all the existing file-watching + hook code keeps working unchanged.

- [ ] **Step 1: Accept the flag + pty manager in `launchNewTerminal`**

Open `src/agentManager.ts`. Add to the imports:

```ts
import type { PtyManager } from './pty/ptyManager.js';
import { PTY_SCROLLBACK_MAX_LINES } from '../server/src/constants.js';
```

Extend the function signature with two new parameters at the end:

```ts
export async function launchNewTerminal(
  // ... existing params ...
  defaultCwd?: string,
  usePtyTerminal?: boolean,
  ptyManager?: PtyManager | null,
): Promise<void> {
```

- [ ] **Step 2: Branch on the flag**

Inside `launchNewTerminal`, find the line that builds the Claude command (currently around line 113-117). Refactor so the same command is sent through either path:

Replace the existing block:

```ts
const terminal = vscode.window.createTerminal({
  name: `${TERMINAL_NAME_PREFIX} #${idx}`,
  cwd,
});
terminal.show();

const sessionId = crypto.randomUUID();
const claudeCmd = bypassPermissions
  ? `claude --session-id ${sessionId} --dangerously-skip-permissions`
  : `claude --session-id ${sessionId}`;
terminal.sendText(claudeCmd);
```

with:

```ts
const sessionId = crypto.randomUUID();
const claudeArgs = bypassPermissions
  ? ['--session-id', sessionId, '--dangerously-skip-permissions']
  : ['--session-id', sessionId];

let terminal: vscode.Terminal | undefined;
let ptyBacked = false;

if (usePtyTerminal && ptyManager) {
  // Spawn via node-pty so the terminal renders inside the office panel.
  // The default shell selection mirrors what VS Code does on each platform.
  const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh');
  ptyManager.start(nextAgentIdRef.current, {
    shell,
    args: ['-l', '-c', `claude ${claudeArgs.join(' ')}`],
    cwd,
    env: process.env as Record<string, string | undefined>,
    cols: 80,
    rows: 24,
    scrollbackCapacity: PTY_SCROLLBACK_MAX_LINES,
  });
  ptyBacked = true;
} else {
  terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
  });
  terminal.show();
  const claudeCmd = bypassPermissions
    ? `claude --session-id ${sessionId} --dangerously-skip-permissions`
    : `claude --session-id ${sessionId}`;
  terminal.sendText(claudeCmd);
}
```

Note: `nextAgentIdRef.current` is read here BEFORE the existing `const id = nextAgentIdRef.current++;` line. That's intentional: the pty needs to know the agent id so its outbound messages carry the right id. After this block, the existing `const id = nextAgentIdRef.current++;` increments and uses that same id. **Don't double-increment.** Replace the existing `const id = nextAgentIdRef.current++;` with `const id = nextAgentIdRef.current; nextAgentIdRef.current++;` to make the order explicit.

Then in the agent object literal, set `terminalRef: terminal` (now `undefined` in the pty path — that's fine, it's already optional) and `ptyBacked`:

```ts
const agent: AgentState = {
  id,
  sessionId,
  terminalRef: terminal,
  isExternal: false,
  // ... existing fields ...
  ptyBacked,
  // ... existing fields ...
};
```

- [ ] **Step 3: Update call sites in `PixelAgentsViewProvider`**

Open `src/PixelAgentsViewProvider.ts`. Find every `launchNewTerminal(` call (there should be 1-2 — search for it). Pass the new args:

```ts
await launchNewTerminal(
  // ... existing args ...
  defaultCwd,
  this.usePtyTerminal.current,
  this.ptyManager,
);
```

- [ ] **Step 4: Type-check + tests + build**

```bash
npx tsc -b --noEmit
npm test
npm run package
```

Expected: 201 tests still pass (none of the existing tests exercise the new branch); build clean.

- [ ] **Step 5: Commit**

```bash
git add src/agentManager.ts src/PixelAgentsViewProvider.ts
git commit -m "feat(agents): branch launchNewTerminal on usePtyTerminal"
```

---

## Task 9: Agent close cleanup

**Files:**

- Modify: `src/PixelAgentsViewProvider.ts` (and/or wherever agent removal happens)

When the user closes a pty-backed agent (X button in the office), the pty needs to be killed. Find the existing `closeAgent` handler and add a `PtyManager.stop()` call.

- [ ] **Step 1: Find the close handler**

```bash
grep -n "closeAgent\|removeAgent" src/PixelAgentsViewProvider.ts | head -10
```

There's already a `closeAgent` message handler (around line 450 — `else if (message.type === 'closeAgent')`). It calls `agent.terminalRef.dispose()` for legacy agents.

- [ ] **Step 2: Add the pty stop branch**

Edit the existing `closeAgent` handler. After fetching `agent`, branch on `agent.ptyBacked`:

```ts
} else if (message.type === 'closeAgent') {
  const agent = this.agents.get(message.id as number);
  if (agent) {
    if (agent.ptyBacked) {
      this.ptyManager?.stop(agent.id);
    } else if (agent.terminalRef) {
      agent.terminalRef.dispose();
    }
    // ... rest of the existing cleanup ...
  }
}
```

Don't remove the existing legacy branch — just add the pty branch above it. The else-if structure means only one path runs.

- [ ] **Step 3: Type-check + smoke**

```bash
npx tsc -b --noEmit
npm test
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "feat(agents): close pty-backed agents via PtyManager.stop"
```

---

## Task 10: Persistence policy — pty agents are runtime-only

**Files:**

- Modify: `src/agentManager.ts` (or wherever `persistAgents` lives)

`restoreAgents` recreates `vscode.window.createTerminal` agents on extension reload. Pty-backed agents shouldn't try to restore — they'd respawn a fresh pty, but the underlying Claude session would be lost. Simpler: skip persistence for pty agents in v1. They die on reload; user re-spawns with `+ Agent`.

- [ ] **Step 1: Find `persistAgents`**

```bash
grep -n "persistAgents\|workspaceState.update" src/agentManager.ts | head -10
```

Find the function that writes `PersistedAgent[]` to workspaceState.

- [ ] **Step 2: Filter out pty agents on persist**

In the persistence function, when building the array of agents to persist, skip any where `agent.ptyBacked === true`:

```ts
const persistable = [...agents.values()].filter((a) => a.ptyBacked !== true);
```

(Or, more locally: in the `.map` call that builds `PersistedAgent` entries, add an `.filter` BEFORE the `.map`.)

- [ ] **Step 3: Document the limitation**

Open the existing `PixelAgentsViewProvider.ts` near the `restoreAgents` call. Add a one-line comment:

```ts
// Note: pty-backed agents are runtime-only in v1 — they're not persisted via
// persistAgents() (filter applied there). On extension reload, the user must
// re-spawn them with + Agent. Future: re-attach via `claude --resume <id>`.
```

- [ ] **Step 4: Type-check + tests**

```bash
npx tsc -b --noEmit
npm test
```

Expected: 201 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agentManager.ts src/PixelAgentsViewProvider.ts
git commit -m "feat(agents): pty-backed agents are runtime-only in v1 (documented)"
```

---

## Task 11: Final verification + smoke + merge

**Files:** none

- [ ] **Step 1: Full verification gate**

```bash
cd /Users/angel/Desktop/pixel-agents
npx tsc -b --noEmit
npm run lint
npm test
npm run package
node -e "Module = require('module'); const o=Module._resolveFilename; Module._resolveFilename = (r,...a)=>r==='vscode'?require.resolve('path'):o.call(Module,r,...a); require('./dist/extension.js'); console.log('OK')"
```

Expected: tsc clean, lint clean, ~208 tests passing (201 + 7 new PtyEventBus), build clean, activation check prints `OK`.

- [ ] **Step 2: Package the VSIX**

```bash
npx vsce package --no-dependencies
ls -lh pixel-agents-1.3.0.vsix
```

Expected size: 3.2-3.8 MB (was 3.1 MB; xterm.js adds ~300-600 KB to the webview bundle).

- [ ] **Step 3: Install + smoke test**

Install:

```bash
code --install-extension /Users/angel/Desktop/pixel-agents/pixel-agents-1.3.0.vsix
```

Reload all VS Code windows.

Smoke test:

1. Open the Pixel Agents side panel. Verify the existing office UI loads.
2. Open Settings (gear icon). Verify **"Use in-panel terminal (experimental)"** is present and unchecked.
3. Click `+ Agent` while the setting is OFF. Verify the existing behavior: VS Code terminal opens with `claude --session-id ...`. Agent appears in the office. The panel's terminal area shows the `TerminalPaneStub` placeholder.
4. Toggle the setting ON.
5. Click `+ Agent`. **The bottom drawer should auto-open to the new agent, and you should see an actual terminal prompt inside the drawer** (Claude's intro screen, etc.). Typing in the pane sends keystrokes to Claude. Resize the panel and confirm xterm.js refits.
6. Click a different agent (pre-existing legacy one). The drawer switches to its `TerminalPaneStub`.
7. Click the pty-backed agent again. The xterm.js pane reappears with its existing state (scrollback preserved).
8. Close the pty-backed agent via the X. Verify the pty process exits (check process list with `ps aux | grep claude`).
9. Reload the window. Verify only legacy agents are restored; the pty-backed one is gone (as documented).

Document any bugs found and fix them in a follow-up commit before merge.

- [ ] **Step 4: Merge to main**

```bash
git checkout main
git pull --ff-only
git merge --ff-only feature/xterm-terminal-pane
git log --oneline -15
git branch -d feature/xterm-terminal-pane
```

- [ ] **Step 5: Rebuild the install**

```bash
npm run package
npx vsce package --no-dependencies
code --install-extension /Users/angel/Desktop/pixel-agents/pixel-agents-1.3.0.vsix
```

Reload windows. You're done.

---

## Out of scope (next plans)

- **Resume on reload.** Detect persisted pty agents, restore by re-spawning the pty with `claude --resume <sessionId>` (requires storing `sessionId` + cwd + shell across restarts and validating Claude CLI supports it for the session).
- **Copy/paste integration.** xterm.js's selection-to-clipboard works on its own, but VS Code's `Cmd+C` / `Cmd+V` clipboard commands don't route here. Either wire `webview.postMessage`-based clipboard messaging or accept xterm.js native behavior.
- **Windows hardening.** ConPTY differences in ANSI handling, default-shell resolution, signal semantics.
- **Theme + font customization beyond `terminalFontSize`.** Currently the xterm.js theme is hardcoded to `PANEL_BG_CHROME`; consider exposing a few more colors or matching a VS Code theme.
- **`ptyBacked` toggle per existing agent.** Today the flag is set at spawn time; you can't convert a legacy agent to pty mid-session. Likely never needed.

---

## Self-Review Checklist (run before handoff)

- [ ] **Spec coverage:** TerminalPane (Task 4), branching on ptyBacked (Task 5), settings persistence (Tasks 6-7), launchNewTerminal rewire (Task 8), cleanup (Task 9), persistence policy (Task 10). All covered.
- [ ] **Placeholder scan:** No "TBD" or "fill in later" in the plan body. Every step has actual code or actual commands.
- [ ] **Type consistency:** `PtyEventBus.subscribe(agentId, event, handler)` shape consistent across Task 2 (definition), Task 3 (caller in useExtensionMessages), Task 4 (caller in TerminalPane). `usePtyTerminal` field name consistent in `GLOBAL_KEY_USE_PTY_TERMINAL`, `setUsePtyTerminal` message, `usePtyTerminal` in `ExtensionMessageState`. `ptyBacked` flag consistent.
- [ ] **TDD discipline:** Tasks 2 (PtyEventBus) is full TDD. Other tasks are wiring / integration and rely on manual smoke (acknowledged — no React test harness in the project).
- [ ] **Frequent commits:** 11 tasks, ~11 commits.
