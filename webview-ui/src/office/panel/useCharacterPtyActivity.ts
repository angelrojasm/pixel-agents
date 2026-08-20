import { useEffect, useRef } from 'react';

import { PTY_ACTIVITY_HOLD_MS, PTY_ACTIVITY_THROTTLE_MS } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import type { PtyEventBus } from './ptyEventBus.js';

/** Pure core — returns the new ptyActivityUntil deadline, or null when the
 *  bump falls inside the throttle window. Exported for tests. */
export function nextActivityBump(lastBumpAt: number, now: number): number | null {
  if (now - lastBumpAt < PTY_ACTIVITY_THROTTLE_MS) return null;
  return now + PTY_ACTIVITY_HOLD_MS;
}

/** Bump the focused agent's character on pty output so it types in real
 *  time. Mutates the character directly — re-rendering React per byte is
 *  deliberate non-goal; the canvas renderer polls Date.now() each frame. */
export function useCharacterPtyActivity(
  agentId: number | null,
  bus: PtyEventBus,
  officeState: OfficeState,
): void {
  const lastBumpRef = useRef(0);
  useEffect(() => {
    if (agentId == null) return;
    const sub = bus.subscribeActivity(agentId, () => {
      const deadline = nextActivityBump(lastBumpRef.current, Date.now());
      if (deadline == null) return;
      lastBumpRef.current = Date.now();
      const ch = officeState.characters.get(agentId);
      if (ch) ch.ptyActivityUntil = deadline;
    });
    return () => sub.dispose();
  }, [agentId, bus, officeState]);
}
