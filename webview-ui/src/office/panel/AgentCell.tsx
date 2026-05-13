import {
  PANEL_ACCENT,
  PANEL_BG_CELL,
  PANEL_BORDER,
  PANEL_MUTED,
  PANEL_SPRITE_PLACEHOLDER,
  PANEL_WAITING,
} from '../../constants.js';
import type { AgentSummary, PanelPosition } from './panelTypes.js';

interface AgentCellProps {
  agent: AgentSummary;
  variant: 'rail' | 'rail-side' | 'tab';
  panelPosition: PanelPosition;
  isFocused: boolean;
  onClick: () => void;
}

const SIZES = {
  rail: { width: 72, height: 20, fontSize: 10 },
  'rail-side': { width: 24, height: 24, fontSize: 0 },
  tab: { width: 56, height: 16, fontSize: 9 },
} as const;

const STATUS_COLOR: Record<AgentSummary['status'], string> = {
  active: PANEL_ACCENT,
  waiting: PANEL_WAITING,
  idle: PANEL_MUTED,
};

type DropEdge = 'top' | 'right' | 'bottom' | 'left' | null;

function focusDropEdge(
  variant: 'rail' | 'rail-side' | 'tab',
  panelPosition: PanelPosition,
): DropEdge {
  // Only LiteRail-context variants can render focused; PanelHeader filters
  // the focused agent out of its tab/other-agent list.
  if (variant === 'rail') return 'top';
  if (variant === 'rail-side') return panelPosition === 'left' ? 'right' : 'left';
  return null;
}

export function AgentCell({ agent, variant, panelPosition, isFocused, onClick }: AgentCellProps) {
  const { width, height, fontSize } = SIZES[variant];
  const borderColor = isFocused ? PANEL_ACCENT : PANEL_BORDER;
  const isSquare = variant === 'rail-side';
  const dropEdge = isFocused ? focusDropEdge(variant, panelPosition) : null;

  const borderStyle: React.CSSProperties = {
    borderTop: dropEdge === 'top' ? 'none' : `1px solid ${borderColor}`,
    borderRight: dropEdge === 'right' ? 'none' : `1px solid ${borderColor}`,
    borderBottom: dropEdge === 'bottom' ? 'none' : `1px solid ${borderColor}`,
    borderLeft: dropEdge === 'left' ? 'none' : `1px solid ${borderColor}`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="panel-cell-hover"
      style={{
        width,
        height,
        background: PANEL_BG_CELL,
        ...borderStyle,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isSquare ? 'center' : 'flex-start',
        gap: isSquare ? 0 : 4,
        padding: isSquare ? 0 : '0 4px',
        cursor: 'pointer',
        fontSize,
        position: 'relative',
      }}
      title={agent.name}
    >
      <span
        aria-hidden
        style={{
          width: isSquare ? 10 : 6,
          height: isSquare ? 12 : 8,
          background: PANEL_SPRITE_PLACEHOLDER,
          flex: '0 0 auto',
        }}
      />
      {!isSquare && (
        <span
          style={{
            color: isFocused ? PANEL_ACCENT : PANEL_MUTED,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: '1 1 auto',
            textAlign: 'left',
          }}
        >
          {agent.name}
        </span>
      )}
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 0,
          background: STATUS_COLOR[agent.status],
          flex: '0 0 auto',
          position: isSquare ? 'absolute' : 'static',
          top: isSquare ? 2 : undefined,
          right: isSquare ? 2 : undefined,
        }}
      />
    </button>
  );
}
