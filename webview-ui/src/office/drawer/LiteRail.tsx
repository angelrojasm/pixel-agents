import { DRAWER_BG_CHROME, DRAWER_BORDER, DRAWER_MUTED, RAIL_HEIGHT_PX } from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary } from './drawerTypes.js';

interface LiteRailProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  onFocusAgent: (id: number) => void;
  onHideRail: () => void;
}

export function LiteRail({ agents, focusedAgentId, onFocusAgent, onHideRail }: LiteRailProps) {
  return (
    <div
      style={{
        height: RAIL_HEIGHT_PX,
        background: DRAWER_BG_CHROME,
        borderTop: `2px solid ${DRAWER_BORDER}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {agents.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant="rail"
            isFocused={a.id === focusedAgentId}
            onClick={() => onFocusAgent(a.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onHideRail}
        style={{
          background: 'transparent',
          border: 'none',
          color: DRAWER_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 4px',
        }}
        title="Hide rail"
      >
        [hide]
      </button>
    </div>
  );
}
