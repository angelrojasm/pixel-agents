import { PANEL_ACCENT, PANEL_BG_CHROME, PANEL_MUTED } from '../../constants.js';

interface TerminalPaneStubProps {
  agentId: number | null;
  agentName: string | null;
  fontSize: number;
}

export function TerminalPaneStub({ agentId, agentName, fontSize }: TerminalPaneStubProps) {
  if (agentId == null) {
    return (
      <div
        style={{
          flex: '1 1 auto',
          background: PANEL_BG_CHROME,
          color: PANEL_MUTED,
          fontSize,
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
        background: PANEL_BG_CHROME,
        color: PANEL_ACCENT,
        fontSize,
        padding: 12,
        overflow: 'auto',
      }}
    >
      <div>
        [ terminal — agent #{agentId} ({agentName ?? 'unknown'}) ]
      </div>
      <div style={{ color: PANEL_MUTED, marginTop: 4 }}>
        This agent is running in VS Code&apos;s native terminal strip. To render the terminal here
        in the panel, enable &quot;Use in-panel terminal&quot; in Settings, then spawn a new agent
        with + Agent. Existing agents stay on the native terminal.
      </div>
    </div>
  );
}
