import { LiteRail } from './LiteRail.js';
import { PanelHeader } from './PanelHeader.js';
import type { Band } from './panelLayout.js';
import type { AgentSummary, PanelState } from './panelTypes.js';
import { isHorizontalAxis, PanelMode } from './panelTypes.js';
import type { PtyEventBus } from './ptyEventBus.js';
import { RailPeek } from './RailPeek.js';
import { TerminalPane } from './TerminalPane.js';
import { TerminalPaneStub } from './TerminalPaneStub.js';

interface OfficePanelProps {
  agents: AgentSummary[];
  state: PanelState;
  band: Band;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
  onToggleRailHidden: () => void;
  ptyBackedByAgent: Record<number, boolean>;
  ptyEventBus: PtyEventBus;
}

export function OfficePanel({
  agents,
  state,
  band,
  onFocusAgent,
  onCollapse,
  onToggleRailHidden,
  ptyBackedByAgent,
  ptyEventBus,
}: OfficePanelProps) {
  const focused = agents.find((a) => a.id === state.focusedAgentId) ?? null;
  const horizontal = isHorizontalAxis(state.panelPosition);

  // Outer dimensions: bottom panel uses height, sides use width.
  const outerStyle = horizontal
    ? { height: band.bandSize, flex: `0 0 ${band.bandSize}px`, minHeight: 0 }
    : { width: band.bandSize, flex: `0 0 ${band.bandSize}px`, height: '100%', minWidth: 0 };

  if (band.mode === PanelMode.PEEK) {
    return (
      <div style={outerStyle}>
        <RailPeek panelPosition={state.panelPosition} onRestore={onToggleRailHidden} />
      </div>
    );
  }

  if (band.mode === PanelMode.RAIL) {
    return (
      <div style={outerStyle}>
        <LiteRail
          agents={agents}
          focusedAgentId={state.focusedAgentId}
          panelPosition={state.panelPosition}
          onFocusAgent={onFocusAgent}
          onHideRail={onToggleRailHidden}
        />
      </div>
    );
  }

  // OPEN: header + terminal area, stacked along the panel's column.
  return (
    <div
      style={{
        ...outerStyle,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PanelHeader
        agents={agents}
        focusedAgentId={state.focusedAgentId}
        panelPosition={state.panelPosition}
        onFocusAgent={onFocusAgent}
        onCollapse={onCollapse}
      />
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {state.focusedAgentId !== null && ptyBackedByAgent[state.focusedAgentId] ? (
          <TerminalPane
            agentId={state.focusedAgentId}
            agentName={focused?.name ?? null}
            fontSize={state.terminalFontSize}
            bus={ptyEventBus}
          />
        ) : (
          <TerminalPaneStub
            agentId={state.focusedAgentId}
            agentName={focused?.name ?? null}
            fontSize={state.terminalFontSize}
          />
        )}
      </div>
    </div>
  );
}
