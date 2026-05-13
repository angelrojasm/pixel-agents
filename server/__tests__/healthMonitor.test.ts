import { describe, expect, it, vi } from 'vitest';

import {
  HOOK_HEALTH_BOOT_GRACE_MS,
  HOOK_HEARTBEAT_MISS_DEGRADED,
  HOOK_HEARTBEAT_MISS_DOWN,
} from '../src/constants.js';
import { HealthMonitor, type HealthState } from '../src/healthMonitor.js';

describe('HealthMonitor', () => {
  function setup(initialNow = 1_000): {
    monitor: HealthMonitor;
    events: HealthState[];
    advance: (ms: number) => void;
    now: () => number;
  } {
    let clock = initialNow;
    const events: HealthState[] = [];
    const monitor = new HealthMonitor({
      now: () => clock,
      onChange: (s) => events.push({ ...s }),
    });
    return {
      monitor,
      events,
      advance: (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
  }

  it('first heartbeat transitions boot → ok', () => {
    const { monitor, events } = setup();
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('staying in boot before grace expires does NOT emit down', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS - 100);
    monitor.tick();
    expect(events.find((e) => e.status === 'down')).toBeUndefined();
  });

  it('boot + grace expired + no heartbeat → down', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 100);
    monitor.tick();
    expect(events.at(-1)?.status).toBe('down');
  });

  it('HOOK_HEARTBEAT_MISS_DEGRADED missed → degraded', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DEGRADED; i++) {
      advance(10_000); // bigger than HOOK_HEARTBEAT_INTERVAL_MS to count as a miss
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('degraded');
  });

  it('HOOK_HEARTBEAT_MISS_DOWN total missed → down', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DOWN; i++) {
      advance(10_000);
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('down');
  });

  it('degraded → ok on a single heartbeat', () => {
    const { monitor, events, advance } = setup();
    monitor.heartbeat();
    for (let i = 0; i < HOOK_HEARTBEAT_MISS_DEGRADED; i++) {
      advance(10_000);
      monitor.tick();
    }
    expect(events.at(-1)?.status).toBe('degraded');
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('down → ok on a single heartbeat', () => {
    const { monitor, events, advance } = setup();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 100);
    monitor.tick();
    expect(events.at(-1)?.status).toBe('down');
    monitor.heartbeat();
    expect(events.at(-1)?.status).toBe('ok');
  });

  it('repeated ok heartbeats do NOT re-emit ok events', () => {
    const { monitor, events } = setup();
    monitor.heartbeat();
    const baseline = events.length;
    monitor.heartbeat();
    monitor.heartbeat();
    expect(events.length).toBe(baseline);
  });

  it('dispose stops further events', () => {
    const { monitor, events, advance } = setup();
    monitor.dispose();
    advance(HOOK_HEALTH_BOOT_GRACE_MS + 1_000);
    monitor.tick();
    expect(events).toEqual([]);
  });
});
