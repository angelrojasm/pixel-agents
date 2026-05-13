import {
  HOOK_HEALTH_DOT_COLOR_DEGRADED,
  HOOK_HEALTH_DOT_COLOR_DOWN,
  HOOK_HEALTH_DOT_SIZE_PX,
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BG_CHROME,
  PANEL_BORDER,
  PANEL_HEADER_THICKNESS_PX,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
} from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';
import { isHorizontalAxis } from './panelTypes.js';

interface PanelHeaderProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  panelPosition: PanelPosition;
  hookHealth: 'ok' | 'degraded' | 'down';
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
}

export function PanelHeader({
  agents,
  focusedAgentId,
  panelPosition,
  hookHealth,
  onFocusAgent,
  onCollapse,
}: PanelHeaderProps) {
  const focused = agents.find((a) => a.id === focusedAgentId) ?? null;
  const others = agents.filter((a) => a.id !== focusedAgentId);
  const horizontal = isHorizontalAxis(panelPosition);
  const collapseLabel = horizontal
    ? '[↓ hide]'
    : panelPosition === 'left'
      ? '[← hide]'
      : '[→ hide]';

  return (
    <div
      style={{
        ...(horizontal
          ? {
              height: PANEL_HEADER_THICKNESS_PX,
              flexDirection: 'row',
              borderTop: `2px solid ${PANEL_BORDER}`,
            }
          : {
              width: '100%',
              flexDirection: 'column',
              borderBottom: `2px solid ${PANEL_BORDER}`,
            }),
        background: PANEL_BG_CHROME,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
      }}
    >
      {focused && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 8px',
            height: '100%',
            background: PANEL_BG_CELL,
            ...(horizontal ? { margin: '-4px 0', borderBottom: `2px solid ${PANEL_ACCENT}` } : {}),
          }}
        >
          <span
            aria-hidden
            style={{
              width: 10,
              height: 12,
              background: PANEL_SPRITE_PLACEHOLDER,
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: PANEL_ACCENT, fontSize: 10 }}>{focused.name}</span>
        </div>
      )}
      <div
        className="pixel-scrollbar"
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: 'center',
          gap: 4,
          flex: '1 1 auto',
          overflow: 'auto',
        }}
      >
        {others.map((a) => (
          <AgentCell
            key={a.id}
            agent={a}
            variant={horizontal ? 'tab' : 'rail-side'}
            panelPosition={panelPosition}
            isFocused={false}
            onClick={() => onFocusAgent(a.id)}
          />
        ))}
      </div>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <button
          type="button"
          onClick={onCollapse}
          className="panel-icon-hover"
          style={{
            background: 'transparent',
            border: 'none',
            color: PANEL_MUTED,
            fontSize: 10,
            cursor: 'pointer',
            padding: '0 4px',
          }}
          title="Hide panel"
        >
          {collapseLabel}
        </button>
        {hookHealth !== 'ok' && (
          <span
            aria-label={`Hook server status: ${hookHealth}`}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: HOOK_HEALTH_DOT_SIZE_PX,
              height: HOOK_HEALTH_DOT_SIZE_PX,
              background:
                hookHealth === 'down' ? HOOK_HEALTH_DOT_COLOR_DOWN : HOOK_HEALTH_DOT_COLOR_DEGRADED,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
