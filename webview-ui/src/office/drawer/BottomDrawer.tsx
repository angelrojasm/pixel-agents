import { DRAWER_HEADER_HEIGHT_PX } from '../../constants.js';
import { DrawerHeader } from './DrawerHeader.js';
import type { Band } from './drawerLayout.js';
import type { AgentSummary, DrawerState } from './drawerTypes.js';
import { DrawerMode } from './drawerTypes.js';
import { LiteRail } from './LiteRail.js';
import { RailPeek } from './RailPeek.js';
import { TerminalPaneStub } from './TerminalPaneStub.js';

interface BottomDrawerProps {
  agents: AgentSummary[];
  state: DrawerState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
}

export function BottomDrawer({
  agents,
  state,
  band,
  onFocusAgent,
  onCollapse,
  onToggleRailHidden,
}: BottomDrawerProps) {
  const focused = agents.find((a) => a.id === state.focusedAgentId) ?? null;

  if (band.mode === DrawerMode.PEEK) {
    return (
      <div style={{ height: band.bandHeight, flex: `0 0 ${band.bandHeight}px` }}>
        <RailPeek onRestore={onToggleRailHidden} />
      </div>
    );
  }

  if (band.mode === DrawerMode.RAIL) {
    return (
      <div style={{ height: band.bandHeight, flex: `0 0 ${band.bandHeight}px` }}>
        <LiteRail
          agents={agents}
          focusedAgentId={state.focusedAgentId}
          onFocusAgent={onFocusAgent}
          onHideRail={onToggleRailHidden}
        />
      </div>
    );
  }

  // OPEN
  const terminalHeight = Math.max(0, band.bandHeight - DRAWER_HEADER_HEIGHT_PX);
  return (
    <div
      style={{
        height: band.bandHeight,
        flex: `0 0 ${band.bandHeight}px`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DrawerHeader
        agents={agents}
        focusedAgentId={state.focusedAgentId}
        onFocusAgent={onFocusAgent}
        onCollapse={onCollapse}
      />
      <div style={{ height: terminalHeight, display: 'flex', flexDirection: 'column' }}>
        <TerminalPaneStub agentId={state.focusedAgentId} agentName={focused?.name ?? null} />
      </div>
    </div>
  );
}
