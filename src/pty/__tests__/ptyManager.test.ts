import { describe, expect, it } from 'vitest';

import { PtyManager } from '../ptyManager.js';
import { isPtyInputMessage } from '../ptyProtocol.js';
import type { PtyWorker } from '../ptyWorker.js';

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

/** Minimal PtyWorker fake that exposes manual triggers for data/exit so tests
 *  can drive the manager deterministically without spawning a real subprocess. */
interface FakeWorker {
  worker: PtyWorker;
  fireData: (chunk: string) => void;
  fireExit: (info: { code: number; signal?: string }) => void;
}

function makeFakeWorker(): FakeWorker {
  const dataHandlers: ((c: string) => void)[] = [];
  const exitHandlers: ((info: { code: number; signal?: string }) => void)[] = [];
  const worker = {
    onData: (h: (c: string) => void) => {
      dataHandlers.push(h);
    },
    onExit: (h: (info: { code: number; signal?: string }) => void) => {
      exitHandlers.push(h);
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
    scrollback: () => [],
    isAlive: () => true,
  } as unknown as PtyWorker;
  return {
    worker,
    fireData: (chunk) => dataHandlers.forEach((h) => h(chunk)),
    fireExit: (info) => exitHandlers.forEach((h) => h(info)),
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

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (sink.sent.some((m) => m.type === 'ptyExit' && m.agentId === 2)) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

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
      args: ['-c', 'read line; printf "got:%s\\n" "$line"'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

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

    expect(() => source.emit({ type: 'ptyInput', agentId: 999, data: 'x' })).not.toThrow();
    expect(() =>
      source.emit({ type: 'ptyResize', agentId: 999, cols: 80, rows: 24 }),
    ).not.toThrow();
    expect(sink.sent.filter((m) => m.agentId === 999).length).toBe(0);

    manager.disposeAll();
  });

  it('attachSource() routes inbound messages from a second source to the same workers', () => {
    const sink = makeSink();
    const source = makeSource();
    const manager = new PtyManager({ sink, source });

    manager.start(7, {
      shell: '/bin/sh',
      args: ['-c', 'read line; printf "got:%s\\n" "$line"'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    // Attach a SECOND source (simulating a second webview).
    const secondSource = makeSource();
    manager.attachSource(secondSource);

    // Emit from the second source — manager should still write to the worker.
    secondSource.emit({ type: 'ptyInput', agentId: 7, data: 'world\n' });

    // Wait for the subprocess to consume + exit.
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (sink.sent.some((m) => m.type === 'ptyExit' && m.agentId === 7)) {
          clearInterval(interval);
          const out = sink.sent
            .filter((m) => m.type === 'ptyData' && m.agentId === 7)
            .map((m) => m.data)
            .join('');
          expect(out).toContain('got:world');
          manager.disposeAll();
          resolve();
        }
      }, 10);
    });
  });

  it('non-zero exit broadcasts both ptyExit and agentCrashed', () => {
    const sink = makeSink();
    const source = makeSource();
    const fake = makeFakeWorker();
    const manager = new PtyManager({ sink, source, workerFactory: () => fake.worker });

    manager.start(10, {
      shell: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    fake.fireExit({ code: 1, signal: undefined });

    const exits = sink.sent.filter((m) => m.type === 'ptyExit' && m.agentId === 10);
    const crashes = sink.sent.filter((m) => m.type === 'agentCrashed' && m.agentId === 10);
    expect(exits).toHaveLength(1);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].code).toBe(1);

    manager.disposeAll();
  });

  it('clean exit (code=0, no signal) broadcasts ptyExit only', () => {
    const sink = makeSink();
    const source = makeSource();
    const fake = makeFakeWorker();
    const manager = new PtyManager({ sink, source, workerFactory: () => fake.worker });

    manager.start(11, {
      shell: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    fake.fireExit({ code: 0, signal: undefined });

    const exits = sink.sent.filter((m) => m.type === 'ptyExit' && m.agentId === 11);
    const crashes = sink.sent.filter((m) => m.type === 'agentCrashed' && m.agentId === 11);
    expect(exits).toHaveLength(1);
    expect(crashes).toHaveLength(0);

    manager.disposeAll();
  });

  it('intentional stop suppresses agentCrashed even on non-zero exit', () => {
    const sink = makeSink();
    const source = makeSource();
    const fake = makeFakeWorker();
    const manager = new PtyManager({ sink, source, workerFactory: () => fake.worker });

    manager.start(12, {
      shell: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    // Caller intentionally stops the agent (e.g. user closed it). The worker
    // may exit with a signal as a result of being killed — that exit must NOT
    // be treated as a crash.
    manager.stop(12);
    fake.fireExit({ code: 0, signal: 'SIGTERM' });

    const exits = sink.sent.filter((m) => m.type === 'ptyExit' && m.agentId === 12);
    const crashes = sink.sent.filter((m) => m.type === 'agentCrashed' && m.agentId === 12);
    // ptyExit is still emitted (downstream may want to know the pty is gone).
    expect(exits).toHaveLength(1);
    // agentCrashed is suppressed because the stop was intentional.
    expect(crashes).toHaveLength(0);

    manager.disposeAll();
  });
});
