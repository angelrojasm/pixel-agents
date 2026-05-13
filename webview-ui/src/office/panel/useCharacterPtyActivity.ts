import { useEffect, useRef } from 'react';

import type { OfficeState } from '../engine/officeState.js';
import type { PtyEventBus } from './ptyEventBus.js';

/**
 * Subscribes to PtyEventBus activity for a single agent and writes the
 * resulting `ptyActivityUntil` timestamp directly onto the character struct
 * in OfficeState. Bypasses React state on purpose: the renderer reads
 * `ch.ptyActivityUntil` every frame, so we don't want to re-render on every
 * byte. The hook only re-installs on (agentId, bus, officeState) change.
 *
 * Falls through harmlessly when the bus has no data (e.g. usePtyTerminal=off).
 */
export function useCharacterPtyActivity(
  agentId: number | null,
  bus: PtyEventBus,
  officeState: OfficeState,
): void {
  const lastBumpRef = useRef(0);
  useEffect(() => {
    if (agentId === null) return;
    const sub = bus.subscribeActivity(agentId, () => {
      const now = performance.now();
      // Cheap throttle: re-write at most every PTY_ACTIVITY_HOLD_MS / 4 ms;
      // the rendering side cares about the deadline, not the bump count.
      if (now - lastBumpRef.current < 50) return;
      lastBumpRef.current = now;
      const ch = officeState.characters.get(agentId);
      if (!ch) return;
      // Use wall-clock (Date.now) so the renderer's Date.now() comparison
      // is in the same epoch. performance.now is just for throttle.
      ch.ptyActivityUntil = Date.now() + 200; // PTY_ACTIVITY_HOLD_MS — kept inline so the renderer doesn't have to import.
    });
    return () => sub.dispose();
  }, [agentId, bus, officeState]);
}
