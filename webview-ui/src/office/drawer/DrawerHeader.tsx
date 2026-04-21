import {
  DRAWER_ACCENT,
  DRAWER_BG_CELL,
  DRAWER_BG_CHROME,
  DRAWER_BORDER,
  DRAWER_HEADER_HEIGHT_PX,
  DRAWER_MUTED,
  DRAWER_SPRITE_PLACEHOLDER,
} from '../../constants.js';
import { AgentCell } from './AgentCell.js';
import type { AgentSummary } from './drawerTypes.js';

interface DrawerHeaderProps {
  agents: AgentSummary[];
  focusedAgentId: number | null;
  onFocusAgent: (id: number) => void;
  onCollapse: () => void;
}

export function DrawerHeader({
  agents,
  focusedAgentId,
  onFocusAgent,
  onCollapse,
}: DrawerHeaderProps) {
  const focused = agents.find((a) => a.id === focusedAgentId) ?? null;
  const others = agents.filter((a) => a.id !== focusedAgentId);

  return (
    <div
      style={{
        height: DRAWER_HEADER_HEIGHT_PX,
        background: DRAWER_BG_CHROME,
        borderTop: `2px solid ${DRAWER_BORDER}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
      }}
    >
      {focused && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 6px',
            border: `1px solid ${DRAWER_ACCENT}`,
            height: 16,
            background: DRAWER_BG_CELL,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 10,
              background: DRAWER_SPRITE_PLACEHOLDER,
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: DRAWER_ACCENT, fontSize: 10 }}>{focused.name}</span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
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
            variant="tab"
            isFocused={false}
            onClick={() => onFocusAgent(a.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onCollapse}
        style={{
          background: 'transparent',
          border: 'none',
          color: DRAWER_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 4px',
        }}
        title="Hide drawer"
      >
        [↓ hide]
      </button>
    </div>
  );
}
