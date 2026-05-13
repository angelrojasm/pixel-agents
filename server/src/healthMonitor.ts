import {
  HOOK_HEALTH_BOOT_GRACE_MS,
  HOOK_HEARTBEAT_INTERVAL_MS,
  HOOK_HEARTBEAT_MISS_DEGRADED,
  HOOK_HEARTBEAT_MISS_DOWN,
} from './constants.js';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthState {
  status: HealthStatus;
  reason?: string;
  since: number;
}

export interface HealthMonitorOptions {
  /** Injectable clock — tests pass a fake; default uses Date.now. */
  now?: () => number;
  /** Fires when the publicly-visible status changes. */
  onChange?: (state: HealthState) => void;
}

/**
 * Pure state machine for hook-health visibility.
 *
 * - `heartbeat()` records a successful hook event arrival (any provider).
 * - `tick()` is the periodic check that escalates missed heartbeats.
 * - Boot status starts as 'boot' (internal); grace window before exposing 'down'.
 *
 * Transitions are described in the UX spec § Hook-health state machine.
 */
export class HealthMonitor {
  private readonly now: () => number;
  private readonly onChange: ((state: HealthState) => void) | undefined;
  private disposed = false;
  private bootAt: number;
  private lastHeartbeatAt = 0;
  private missedTicks = 0;
  private status: HealthStatus | 'boot' = 'boot';
  private statusSince: number;
  private lastReason: string | undefined;

  constructor(opts: HealthMonitorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.bootAt = this.now();
    this.statusSince = this.bootAt;
  }

  heartbeat(reason?: string): void {
    if (this.disposed) return;
    this.lastHeartbeatAt = this.now();
    this.missedTicks = 0;
    this.lastReason = reason;
    if (this.status !== 'ok') {
      this.transition('ok', reason);
    }
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.now();
    // Boot path: nothing seen yet — grace before reporting down.
    if (this.status === 'boot') {
      if (now - this.bootAt >= HOOK_HEALTH_BOOT_GRACE_MS) {
        this.transition('down', 'boot-grace-elapsed-no-heartbeat');
      }
      return;
    }
    // Only count this tick as a miss if enough time has passed since the last heartbeat.
    const sinceHeartbeat = now - this.lastHeartbeatAt;
    if (sinceHeartbeat >= HOOK_HEARTBEAT_INTERVAL_MS) {
      this.missedTicks += 1;
    }
    if (this.missedTicks >= HOOK_HEARTBEAT_MISS_DOWN) {
      if (this.status !== 'down') this.transition('down', `missed ${this.missedTicks} ticks`);
    } else if (this.missedTicks >= HOOK_HEARTBEAT_MISS_DEGRADED) {
      if (this.status !== 'degraded')
        this.transition('degraded', `missed ${this.missedTicks} ticks`);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  getState(): HealthState | null {
    if (this.status === 'boot') return null;
    return { status: this.status, reason: this.lastReason, since: this.statusSince };
  }

  private transition(status: HealthStatus, reason: string | undefined): void {
    if (this.status === status) return;
    this.status = status;
    this.statusSince = this.now();
    this.lastReason = reason;
    this.onChange?.({ status, reason, since: this.statusSince });
  }
}
