/**
 * Unit tests for the crashed-character OfficeState mutators (Task 6 of the
 * m1.5 character-behaviors slice): `setAgentCrashed` and `acknowledgeCrash`,
 * both of which propagate to live sub-agents so one pty crash/ack event
 * glyphs/clears the whole family, while skipping sub-agents that are already
 * despawning.
 *
 * Construction mirrors greeter.test.ts (an all-floor OfficeLayout with no
 * furniture, fed straight to `new OfficeState(...)` — no catalog needed).
 *
 * Run with: npm run test:webview -- test/crash-state.test.ts
 */
import { describe, expect, it } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

/** All-floor layout, no furniture — no catalog needed, every tile walkable. */
function floorLayout(cols = 9, rows = 7): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

describe('OfficeState crash visual state', () => {
  it('setAgentCrashed marks the agent and its live sub-agents; despawning subs skipped', () => {
    const os = new OfficeState(floorLayout());
    os.addAgent(1);
    const liveSubId = os.addSubagent(1, 'tool-1');
    const despawningSubId = os.addSubagent(1, 'tool-2');
    // Manufacture a despawning sub while it's still tracked in subagentMeta —
    // the guard the mutator is defending against (removeSubagent normally
    // clears subagentMeta in the same call that starts the despawn effect).
    os.characters.get(despawningSubId)!.matrixEffect = 'despawn';

    os.setAgentCrashed(1, true);

    expect(os.characters.get(1)!.crashed).toBe(true);
    expect(os.characters.get(1)!.crashedAcknowledged).toBe(false);
    expect(os.characters.get(liveSubId)!.crashed).toBe(true);
    expect(os.characters.get(liveSubId)!.crashedAcknowledged).toBe(false);
    expect(os.characters.get(despawningSubId)!.crashed).toBe(false);
  });

  it('re-crash after acknowledge re-glyphs (crashedAcknowledged resets)', () => {
    const os = new OfficeState(floorLayout());
    os.addAgent(1);

    os.setAgentCrashed(1, true);
    os.acknowledgeCrash(1);
    os.setAgentCrashed(1, true);

    expect(os.characters.get(1)!.crashedAcknowledged).toBe(false);
  });

  it('setAgentCrashed(false) clears parent and sub-agents (restart path)', () => {
    const os = new OfficeState(floorLayout());
    os.addAgent(1);
    const subId = os.addSubagent(1, 'tool-1');
    os.setAgentCrashed(1, true);
    os.acknowledgeCrash(1);

    os.setAgentCrashed(1, false);

    expect(os.characters.get(1)!.crashed).toBe(false);
    expect(os.characters.get(1)!.crashedAcknowledged).toBe(false);
    expect(os.characters.get(subId)!.crashed).toBe(false);
    expect(os.characters.get(subId)!.crashedAcknowledged).toBe(false);
  });

  it('acknowledgeCrash on the parent also acks its live sub-agents', () => {
    const os = new OfficeState(floorLayout());
    os.addAgent(1);
    const liveSubId = os.addSubagent(1, 'tool-1');
    const despawningSubId = os.addSubagent(1, 'tool-2');

    // Crash parent (subs inherit crashed) — despawn starts only afterward so
    // this pins the ack-time skip specifically, separate from the crash-time
    // skip covered above.
    os.setAgentCrashed(1, true);
    os.characters.get(despawningSubId)!.matrixEffect = 'despawn';

    os.acknowledgeCrash(1);

    expect(os.characters.get(1)!.crashedAcknowledged).toBe(true);
    expect(os.characters.get(liveSubId)!.crashedAcknowledged).toBe(true);
    expect(os.characters.get(despawningSubId)!.crashedAcknowledged).toBe(false);
  });
});
