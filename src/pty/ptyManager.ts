import { PTY_MAX_CHUNK_BYTES, PTY_SCROLLBACK_MAX_LINES } from '../../server/src/constants.js';
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
  /** Agents whose worker was killed via `stop()` / `disposeAll()`. When the
   *  worker.onExit callback fires for one of these, we suppress the
   *  `agentCrashed` broadcast (otherwise restart-on-crash logic would re-fire
   *  on every intentional stop, racing the restart). `ptyExit` is still
   *  broadcast in both cases — only `agentCrashed` is gated. */
  private readonly intentionallyStopped = new Set<number>();
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

    // A restart may follow an intentional stop; clear any lingering marker so
    // a future crash from the new worker is not suppressed.
    this.intentionallyStopped.delete(agentId);

    const worker = this.factory({
      shell: startOpts.shell,
      args: startOpts.args,
      cwd: startOpts.cwd,
      env: startOpts.env,
      cols: startOpts.cols,
      rows: startOpts.rows,
      scrollbackCapacity: startOpts.scrollbackCapacity ?? PTY_SCROLLBACK_MAX_LINES,
    });

    worker.onData((chunk) => this.emitData(agentId, chunk));
    worker.onExit(({ code, signal }) => {
      // Retain the worker entry after exit so a late-mounting webview can
      // still replay scrollback via terminalPaneReady. The worker is reaped
      // explicitly via stop()/disposeAll().
      void this.opts.sink.postMessage({ type: 'ptyExit', agentId, code, signal });
      if (this.intentionallyStopped.has(agentId)) {
        this.intentionallyStopped.delete(agentId);
        return;
      }
      if ((typeof code === 'number' && code !== 0) || typeof signal === 'string') {
        void this.opts.sink.postMessage({ type: 'agentCrashed', agentId, code, signal });
      }
    });

    this.workers.set(agentId, worker);
  }

  has(agentId: number): boolean {
    return this.workers.has(agentId);
  }

  stop(agentId: number): void {
    const w = this.workers.get(agentId);
    if (!w) return;
    // Mark BEFORE kill — the onExit callback may fire synchronously on some
    // platforms, and the marker must be visible when it does.
    this.intentionallyStopped.add(agentId);
    w.kill();
    this.workers.delete(agentId);
  }

  disposeAll(): void {
    for (const [agentId, w] of this.workers) {
      this.intentionallyStopped.add(agentId);
      try {
        w.kill();
      } catch {
        // best effort
      }
    }
    this.workers.clear();
    this.subscription.dispose();
  }

  /** Attach an additional inbound source (e.g. a newly-opened webview). The manager
   *  will forward pty-shaped messages from this source to the existing workers,
   *  in addition to messages from any sources already attached. The returned
   *  disposable detaches just this attachment; the manager's primary source
   *  subscription is unaffected. */
  attachSource(source: MessageSource): { dispose(): void } {
    return source.onMessage((m) => this.handleInbound(m));
  }

  private emitData(agentId: number, chunk: string): void {
    if (Buffer.byteLength(chunk, 'utf8') <= PTY_MAX_CHUNK_BYTES) {
      void this.opts.sink.postMessage({ type: 'ptyData', agentId, data: chunk });
      return;
    }
    // Pathological single write — split at the cap boundary.
    let remaining = chunk;
    while (Buffer.byteLength(remaining, 'utf8') > PTY_MAX_CHUNK_BYTES) {
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
