import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TERMINAL_BAND_DEFAULT_HEIGHT_PX,
  TERMINAL_BAND_HANDLE_HEIGHT_PX,
  TERMINAL_BAND_MAX_HEIGHT_PX,
  TERMINAL_BAND_MIN_HEIGHT_PX,
} from '../../constants.js';
import type { PtyEventBus } from '../../office/panel/ptyEventBus.js';
import type { RailAgent } from './AgentRail.js';
import { AgentRail } from './AgentRail.js';
import { TerminalPane } from './TerminalPane.js';

interface TerminalBandProps {
  agents: RailAgent[];
  focusedId: number | null;
  onFocus: (id: number) => void;
  onClose: (id: number) => void;
  onRestartAgent: (id: number) => void;
  bus: PtyEventBus;
}

/**
 * Bottom terminal band for the browser runtime: drag-resize handle on top,
 * agent rail on the left, one xterm pane for the focused agent. Simplified
 * from v2-orchestrator's OfficePanel (bottom position only in M1).
 */
export function TerminalBand({
  agents,
  focusedId,
  onFocus,
  onClose,
  onRestartAgent,
  bus,
}: TerminalBandProps) {
  const [height, setHeight] = useState(TERMINAL_BAND_DEFAULT_HEIGHT_PX);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startHeight: height };
    },
    [height],
  );

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.startY - e.clientY; // dragging up grows the band
    if (rafRef.current !== null) return; // throttle to one update per frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const next = Math.min(
        TERMINAL_BAND_MAX_HEIGHT_PX,
        Math.max(TERMINAL_BAND_MIN_HEIGHT_PX, drag.startHeight + dy),
      );
      setHeight(next);
    });
  }, []);

  const onHandlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const focused = agents.find((a) => a.id === focusedId) ?? agents[0] ?? null;

  return (
    <div
      className="flex flex-col border-t-2 border-border"
      style={{ height, flex: `0 0 ${height}px`, background: 'var(--color-bg)' }}
      data-testid="terminal-band"
    >
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        className="w-full cursor-row-resize"
        style={{
          height: TERMINAL_BAND_HANDLE_HEIGHT_PX,
          background: 'var(--color-bg-thumb)',
          touchAction: 'none',
        }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal band"
      />
      <div className="flex flex-1 min-h-0">
        <AgentRail
          agents={agents}
          focusedId={focused?.id ?? null}
          onFocus={onFocus}
          onClose={onClose}
        />
        {focused ? (
          <TerminalPane
            agentId={focused.id}
            agentName={focused.label}
            bus={bus}
            onRestartAgent={onRestartAgent}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-2xs text-text-muted">
            No agent terminal
          </div>
        )}
      </div>
    </div>
  );
}
