import { describe, expect, it } from 'vitest';

import { PTY_MAX_CHUNK_BYTES } from '../src/constants.js';
import { PtyManager } from '../src/pty/ptyManager.js';
import type { PtyWorker } from '../src/pty/ptyWorker.js';

interface Frame {
  type: string;
  id?: number;
  data?: string;
  code?: number;
  signal?: string;
}

function makeBroadcast() {
  const frames: Frame[] = [];
  return {
    frames,
    broadcast: (m: Record<string, unknown>) => void frames.push(m as unknown as Frame),
  };
}

interface FakeWorker {
  worker: PtyWorker;
  writes: string[];
  resizes: Array<[number, number]>;
  killed: boolean;
  fireData: (chunk: string) => void;
  fireExit: (info: { code: number; signal?: string }) => void;
}

function makeFakeWorker(scrollbackLines: string[] = []): FakeWorker {
  const dataHandlers: ((c: string) => void)[] = [];
  const exitHandlers: ((info: { code: number; signal?: string }) => void)[] = [];
  const state: FakeWorker = {
    writes: [],
    resizes: [],
    killed: false,
    worker: undefined as unknown as PtyWorker,
    fireData: (chunk) => dataHandlers.forEach((h) => h(chunk)),
    fireExit: (info) => exitHandlers.forEach((h) => h(info)),
  };
  state.worker = {
    onData: (h: (c: string) => void) => void dataHandlers.push(h),
    onExit: (h: (info: { code: number; signal?: string }) => void) => void exitHandlers.push(h),
    write: (d: string) => void state.writes.push(d),
    resize: (c: number, r: number) => void state.resizes.push([c, r]),
    kill: () => {
      state.killed = true;
    },
    scrollback: () => scrollbackLines,
    isAlive: () => !state.killed,
  } as unknown as PtyWorker;
  return state;
}

const START = {
  shell: '/bin/sh',
  args: [] as string[],
  cwd: '/tmp',
  env: {},
  cols: 80,
  rows: 24,
  scrollbackCapacity: 100,
};

describe('PtyManager', () => {
  it('forwards worker output as ptyData frames with the agent id', () => {
    const { frames, broadcast } = makeBroadcast();
    const fake = makeFakeWorker();
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(7, START);
    fake.fireData('hello');
    expect(frames).toContainEqual({ type: 'ptyData', id: 7, data: 'hello' });
  });

  it('splits oversized chunks at the cap boundary', () => {
    const { frames, broadcast } = makeBroadcast();
    const fake = makeFakeWorker();
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(1, START);
    fake.fireData('x'.repeat(PTY_MAX_CHUNK_BYTES + 5));
    const data = frames.filter((f) => f.type === 'ptyData');
    expect(data).toHaveLength(2);
    expect(data[1].data).toBe('xxxxx');
  });

  it('routes write/resize to the worker and scrollback back to the caller', () => {
    const { broadcast } = makeBroadcast();
    const fake = makeFakeWorker(['line-1', 'line-2']);
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(2, START);
    mgr.write(2, 'ls\n');
    mgr.resize(2, 100, 30);
    expect(fake.writes).toEqual(['ls\n']);
    expect(fake.resizes).toEqual([[100, 30]]);
    expect(mgr.scrollback(2)).toEqual(['line-1', 'line-2']);
    expect(mgr.scrollback(999)).toEqual([]);
  });

  it('start is idempotent per id', () => {
    const { broadcast } = makeBroadcast();
    let constructed = 0;
    const fake = makeFakeWorker();
    const mgr = new PtyManager({
      broadcast,
      workerFactory: () => {
        constructed += 1;
        return fake.worker;
      },
    });
    mgr.start(3, START);
    mgr.start(3, START);
    expect(constructed).toBe(1);
  });

  it('non-zero exit broadcasts ptyExit AND agentCrashed', () => {
    const { frames, broadcast } = makeBroadcast();
    const fake = makeFakeWorker();
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(4, START);
    fake.fireExit({ code: 1 });
    expect(frames).toContainEqual({ type: 'ptyExit', id: 4, code: 1, signal: undefined });
    expect(frames).toContainEqual({ type: 'agentCrashed', id: 4, code: 1, signal: undefined });
  });

  it('clean exit broadcasts ptyExit only', () => {
    const { frames, broadcast } = makeBroadcast();
    const fake = makeFakeWorker();
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(5, START);
    fake.fireExit({ code: 0 });
    expect(frames.some((f) => f.type === 'ptyExit')).toBe(true);
    expect(frames.some((f) => f.type === 'agentCrashed')).toBe(false);
  });

  it('intentional stop suppresses agentCrashed even on signalled exit', () => {
    const { frames, broadcast } = makeBroadcast();
    const fake = makeFakeWorker();
    const mgr = new PtyManager({ broadcast, workerFactory: () => fake.worker });
    mgr.start(6, START);
    mgr.stop(6);
    expect(fake.killed).toBe(true);
    fake.fireExit({ code: 0, signal: 'SIGTERM' });
    expect(frames.some((f) => f.type === 'ptyExit')).toBe(true);
    expect(frames.some((f) => f.type === 'agentCrashed')).toBe(false);
  });

  it('a restart after stop is NOT crash-suppressed', () => {
    const { frames, broadcast } = makeBroadcast();
    const first = makeFakeWorker();
    const second = makeFakeWorker();
    const workers = [first, second];
    const mgr = new PtyManager({ broadcast, workerFactory: () => workers.shift()!.worker });
    mgr.start(8, START);
    mgr.stop(8);
    first.fireExit({ code: 0, signal: 'SIGTERM' }); // worker removed from map
    mgr.start(8, START); // restart clears the intentional marker
    second.fireExit({ code: 137, signal: 'SIGKILL' });
    expect(frames.filter((f) => f.type === 'agentCrashed')).toHaveLength(1);
  });

  it('disposeAll kills every worker without crashes', () => {
    const { frames, broadcast } = makeBroadcast();
    const a = makeFakeWorker();
    const b = makeFakeWorker();
    const workers = [a, b];
    const mgr = new PtyManager({ broadcast, workerFactory: () => workers.shift()!.worker });
    mgr.start(10, START);
    mgr.start(11, START);
    mgr.disposeAll();
    expect(a.killed && b.killed).toBe(true);
    a.fireExit({ code: 0, signal: 'SIGTERM' });
    b.fireExit({ code: 0, signal: 'SIGTERM' });
    expect(frames.some((f) => f.type === 'agentCrashed')).toBe(false);
    expect(mgr.has(10)).toBe(false);
  });
});
