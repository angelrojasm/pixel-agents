import {
  DRAWER_ACCENT,
  DRAWER_BG_CELL,
  DRAWER_BORDER,
  DRAWER_MUTED,
  DRAWER_SPRITE_PLACEHOLDER,
  DRAWER_WAITING,
} from '../../constants.js';
import type { AgentSummary } from './drawerTypes.js';

interface AgentCellProps {
  agent: AgentSummary;
  variant: 'rail' | 'tab';
  isFocused: boolean;
  onClick: () => void;
}

const SIZES = {
  rail: { width: 72, height: 20, fontSize: 10 },
  tab: { width: 56, height: 16, fontSize: 9 },
} as const;

const STATUS_COLOR: Record<AgentSummary['status'], string> = {
  active: DRAWER_ACCENT,
  waiting: DRAWER_WAITING,
  idle: DRAWER_MUTED,
};

export function AgentCell({ agent, variant, isFocused, onClick }: AgentCellProps) {
  const { width, height, fontSize } = SIZES[variant];
  const borderColor = isFocused ? DRAWER_ACCENT : DRAWER_BORDER;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width,
        height,
        background: DRAWER_BG_CELL,
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px',
        cursor: 'pointer',
        fontSize,
      }}
      title={agent.name}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 8,
          background: DRAWER_SPRITE_PLACEHOLDER,
          flex: '0 0 auto',
        }}
      />
      <span
        style={{
          color: isFocused ? DRAWER_ACCENT : DRAWER_MUTED,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: '1 1 auto',
          textAlign: 'left',
        }}
      >
        {agent.name}
      </span>
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 0,
          background: STATUS_COLOR[agent.status],
          flex: '0 0 auto',
        }}
      />
    </button>
  );
}
