import { PTY_MAX_CHUNK_BYTES } from '../constants.js';
import type { PtyWorkerOptions } from './ptyWorker.js';
import { PtyWorker } from './ptyWorker.js';

export interface PtyStartOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  /** Per-agent scrollback cap (lines/chunks kept for replay). */
  scrollbackCapacity: number;
}

export interface PtyManagerOptions {
  /** Outbound funnel — typically `(m) => store.broadcast(m)`. Delivery-side
   *  privilege filtering happens in the WS wiring, not here. */
  broadcast(msg: Record<string, unknown>): void;
  /** Test seam: replaces the real node-pty-backed worker. */
  workerFactory?: (opts: PtyWorkerOptions) => PtyWorker;
}

/**
 * Owns one PtyWorker per agent id. Ported from v2-orchestrator's PtyManager,
 * adapted to upstream's dispatch style: the client-message handler calls the
 * imperative methods directly (write/resize/scrollback) instead of the manager
 * subscribing to a message source. Frames use `id` (upstream convention).
 *
 * Wire protocol produced (all privileged-delivery, see httpServer):
 *   ptyData { id, data }        — live output chunks
 *   ptyExit { id, code, signal? } — EVERY exit
 *   agentCrashed { id, code, signal? } — unintentional non-zero exits only
 */
export class PtyManager {
  private readonly workers = new Map<number, PtyWorker>();
  /** Agents whose worker was killed via stop()/disposeAll(). When onExit fires
   *  for one of these, agentCrashed is suppressed (ptyExit still broadcasts). */
  private readonly intentionallyStopped = new Set<number>();
  private readonly factory: (opts: PtyWorkerOptions) => PtyWorker;

  constructor(private readonly opts: PtyManagerOptions) {
    this.factory = opts.workerFactory ?? ((o) => new PtyWorker(o));
  }

  /** Idempotent: an already-running agent keeps its existing worker. */
  start(id: number, startOpts: PtyStartOptions): void {
    if (this.workers.has(id)) return;

    // A restart may follow an intentional stop; clear the marker so a future
    // crash from the new worker is not suppressed.
    this.intentionallyStopped.delete(id);

    const worker = this.factory({
      shell: startOpts.shell,
      args: startOpts.args,
      cwd: startOpts.cwd,
      env: startOpts.env,
      cols: startOpts.cols,
      rows: startOpts.rows,
      scrollbackCapacity: startOpts.scrollbackCapacity,
    });

    worker.onData((chunk) => this.emitData(id, chunk));
    worker.onExit(({ code, signal }) => {
      this.workers.delete(id);
      this.opts.broadcast({ type: 'ptyExit', id, code, signal });
      const intentional = this.intentionallyStopped.has(id);
      this.intentionallyStopped.delete(id);
      if (!intentional && (code !== 0 || signal !== undefined)) {
        this.opts.broadcast({ type: 'agentCrashed', id, code, signal });
      }
    });

    this.workers.set(id, worker);
  }

  write(id: number, data: string): void {
    this.workers.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    this.workers.get(id)?.resize(cols, rows);
  }

  scrollback(id: number): string[] {
    return this.workers.get(id)?.scrollback() ?? [];
  }

  has(id: number): boolean {
    return this.workers.has(id);
  }

  /** Intentional stop (close/restart): kills the worker without an agentCrashed. */
  stop(id: number): void {
    const worker = this.workers.get(id);
    if (!worker) return;
    this.intentionallyStopped.add(id);
    worker.kill();
  }

  disposeAll(): void {
    for (const [id, worker] of this.workers) {
      this.intentionallyStopped.add(id);
      worker.kill();
    }
    this.workers.clear();
  }

  private emitData(id: number, chunk: string): void {
    if (Buffer.byteLength(chunk, 'utf8') <= PTY_MAX_CHUNK_BYTES) {
      this.opts.broadcast({ type: 'ptyData', id, data: chunk });
      return;
    }
    // Pathological single write — split at the cap boundary.
    let remaining = chunk;
    while (remaining.length > 0) {
      const piece = remaining.slice(0, PTY_MAX_CHUNK_BYTES);
      remaining = remaining.slice(PTY_MAX_CHUNK_BYTES);
      this.opts.broadcast({ type: 'ptyData', id, data: piece });
    }
  }
}
