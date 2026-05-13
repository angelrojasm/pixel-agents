import {
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_MUTED,
  PANEL_SIDE_RAIL_PX,
} from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface LiteRailProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  panelPosition: PanelPosition;
  onFocusAgent: (id: number) => void;
  onHideRail: () => void;
}

export function LiteRail({
  agents,
  focusedAgentId,
  panelPosition,
  onFocusAgent,
  onHideRail,
}: LiteRailProps) {
  const horizontal = isHorizontalAxis(panelPosition);
  const variant = horizontal ? 'rail' : 'rail-side';

  const horizontalStyle = {
    height: PANEL_BOTTOM_RAIL_PX,
    borderTop: `2px solid ${PANEL_BORDER}`,
    flexDirection: 'row' as const,
    padding: '0 8px',
  };
  const verticalStyle = {
    width: PANEL_SIDE_RAIL_PX,
    height: '100%',
    flexDirection: 'column' as const,
    padding: '6px 0',
    borderLeft: panelPosition === 'right' ? `2px solid ${PANEL_BORDER}` : undefined,
    borderRight: panelPosition === 'left' ? `2px solid ${PANEL_BORDER}` : undefined,
  };

  return (
    <div
      style={{
        ...(horizontal ? horizontalStyle : verticalStyle),
        background: PANEL_BG_CHROME,
        display: 'flex',
        alignItems: 'center',
        gap: horizontal ? 6 : 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: 'center',
          gap: horizontal ? 6 : 4,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {agents.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant={variant}
            panelPosition={panelPosition}
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
          color: PANEL_MUTED,
          fontSize: horizontal ? 10 : 9,
          cursor: 'pointer',
          padding: horizontal ? '0 4px' : '4px 0',
          writingMode: horizontal ? 'horizontal-tb' : 'vertical-rl',
        }}
        title="Hide rail"
      >
        [hide]
      </button>
    </div>
  );
}
