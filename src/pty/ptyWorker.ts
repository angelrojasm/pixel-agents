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
      const info = {
        code: exitCode,
        signal: signal === undefined || signal === null ? undefined : String(signal),
      };
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
