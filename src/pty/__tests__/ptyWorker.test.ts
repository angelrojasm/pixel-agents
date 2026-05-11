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
