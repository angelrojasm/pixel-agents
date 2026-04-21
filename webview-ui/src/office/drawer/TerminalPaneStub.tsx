import { DRAWER_ACCENT, DRAWER_BG_CHROME, DRAWER_MUTED } from '../../constants.js';

interface TerminalPaneStubProps {
  agentId: number | null;
  agentName: string | null;
}

export function TerminalPaneStub({ agentId, agentName }: TerminalPaneStubProps) {
  if (agentId == null) {
    return (
      <div
        style={{
          flex: '1 1 auto',
          background: DRAWER_BG_CHROME,
          color: DRAWER_MUTED,
          fontSize: 11,
          padding: 12,
        }}
      >
        No agent focused.
      </div>
    );
  }
  return (
    <div
      style={{
        flex: '1 1 auto',
        background: DRAWER_BG_CHROME,
        color: DRAWER_ACCENT,
        fontSize: 11,
        padding: 12,
        overflow: 'auto',
      }}
    >
      <div>
        [ terminal stub — agent #{agentId} ({agentName ?? 'unknown'}) ]
      </div>
      <div style={{ color: DRAWER_MUTED, marginTop: 4 }}>
        xterm.js will replace this stub once the pty backend (D2) lands. For now, the terminal still
        runs in VS Code&apos;s native terminal strip.
      </div>
    </div>
  );
}
