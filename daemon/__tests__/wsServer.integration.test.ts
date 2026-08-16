import * as fs from 'node:fs';
import * as path from 'node:path';
import * as realOs from 'node:os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';

// Isolated HOME. Without it, PixelAgentsServer.start() finds the ambient
// ~/.pixel-agents/server.json and REUSES a live server owned by a running VS Code
// extension host — these assertions would then run against that process instead
// of the one under test (a 404 on the WS upgrade, since older builds have no /ws).
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('os')>('node:os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});

const { PixelAgentsServer } = await import('../../server/src/server.js');

async function connectClient(cfg: { port: number; token: string }): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
    origin: `http://127.0.0.1:${cfg.port}`,
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 1000);
  });
  return ws;
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('PixelAgentsServer WebSocket', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-ws-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

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

  it('rejects on bad origin (socket closes; no open event fires within timeout)', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
        origin: 'http://evil.example',
      });
      const result = await Promise.race([
        new Promise<'open'>((resolve) => ws.on('open', () => resolve('open'))),
        new Promise<'closed'>((resolve) => {
          ws.on('error', () => resolve('closed'));
          ws.on('close', () => resolve('closed'));
        }),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
      ]);
      expect(result).toBe('closed');
      expect(ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('invokes the connect callback cleanup when the socket closes', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      let cleaned = 0;
      server.onWebSocketConnect(() => () => {
        cleaned += 1;
      });
      const ws = await connectClient(cfg);
      ws.close();
      await waitFor(() => cleaned === 1);
      expect(cleaned).toBe(1);
    } finally {
      server.stop();
    }
  });
});

// Mirrors bin/serve.ts wiring: real server + config store + orchestrator +
// shared dispatch, exercised over real WebSockets.
describe('daemon dispatch over WS', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let cfg: { port: number; token: string };
  let orchestrator: import('../orchestrator.js').Orchestrator;
  let config: import('../configStore.js').ConfigStore;
  /** Per-test counter OBJECT, captured by that test's connect-handler closure.
   *  A socket from a previous test whose close event lands late increments its
   *  own (dead) object instead of contaminating the current test's counts. */
  let counters: { attach: number; dispose: number };

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-ws-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
    const { createOrchestrator } = await import('../orchestrator.js');
    const { createConfigStore } = await import('../configStore.js');
    const { createUiDispatch } = await import('../uiDispatch.js');
    const { createDaemonHostActions } = await import('../daemonHostActions.js');

    server = new PixelAgentsServer();
    cfg = await server.start();
    config = createConfigStore(path.join(tmpHome, '.pixel-agents', 'config.json'));
    orchestrator = createOrchestrator({
      broadcastSink: server.getBroadcastSink(),
      server,
      config,
      agentsFilePath: path.join(tmpHome, '.pixel-agents', 'agents.json'),
      assetsRoot: null,
      extensionVersion: '',
    });
    const dispatch = createUiDispatch({
      orchestrator,
      agents: orchestrator.agents as Map<number, import('../../src/types.js').AgentState>,
      broadcastSink: server.getBroadcastSink(),
      config,
      persistAgents: () => orchestrator.persistNow(),
      hostActions: createDaemonHostActions(),
    });
    const local = { attach: 0, dispose: 0 };
    counters = local;
    server.onWebSocketConnect((src, perClientSink) => {
      local.attach += 1;
      const ptySub = orchestrator.ensurePtyManager(src, perClientSink);
      const uiSub = src.onMessage(
        (m) => void dispatch.handle(m, { replySink: perClientSink, isWsClient: true }),
      );
      void orchestrator.replaySnapshotToSink(perClientSink);
      return () => {
        local.dispose += 1;
        ptySub.dispose();
        uiSub.dispose();
      };
    });
  });

  afterEach(() => {
    orchestrator.dispose();
    server.stop();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('setSoundEnabled over WS persists to the config store', async () => {
    const { GLOBAL_KEY_SOUND_ENABLED } = await import('../../src/constants.js');
    const ws = await connectClient(cfg);
    ws.send(JSON.stringify({ type: 'setSoundEnabled', enabled: false }));
    await waitFor(() => config.get(GLOBAL_KEY_SOUND_ENABLED) === false);
    ws.close();
    await waitFor(() => counters.dispose === 1); // drain the close before afterEach
  });

  it('connect/close cycles do not leak pty or dispatch subscriptions', async () => {
    for (let i = 0; i < 3; i++) {
      const ws = await connectClient(cfg);
      ws.close();
      const target = i + 1;
      await waitFor(() => counters.dispose === target);
    }
    expect(counters.attach).toBe(3);
    expect(counters.dispose).toBe(3);
  });

  it('two clients: terminalPaneReady replies only to the requester', async () => {
    const a = await connectClient(cfg);
    const b = await connectClient(cfg);
    const framesA: Array<{ type: string }> = [];
    const framesB: Array<{ type: string }> = [];
    a.on('message', (d) => framesA.push(JSON.parse(String(d)) as { type: string }));
    b.on('message', (d) => framesB.push(JSON.parse(String(d)) as { type: string }));

    // A live worker to answer the scrollback request: /bin/cat stays alive.
    orchestrator.ensurePtyManager({ onMessage: () => ({ dispose: () => {} }) });
    orchestrator.ptyManager!.start(1, {
      shell: '/bin/cat',
      args: [],
      cwd: realOs.tmpdir(),
      env: {},
      cols: 80,
      rows: 24,
    });

    b.send(JSON.stringify({ type: 'terminalPaneReady', agentId: 1 }));
    await waitFor(() => framesB.some((f) => f.type === 'ptyScrollback'));
    await new Promise((r) => setTimeout(r, 200));
    expect(framesA.filter((f) => f.type === 'ptyScrollback')).toHaveLength(0);
    expect(framesB.filter((f) => f.type === 'ptyScrollback')).toHaveLength(1);
    a.close();
    b.close();
    await waitFor(() => counters.dispose === 2); // drain closes before afterEach
  });
});
