import { Checkbox } from '../../ui/Checkbox.js';
import { PathInput } from '../controls/PathInput.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface AgentsPanelProps {
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  defaultCwd: string;
  onChangeDefaultCwd: (v: string) => void;
  onRestoreDefaults: () => void;
}

export function AgentsPanel(props: AgentsPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Agents" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Watch All Sessions"
          helper="Show agents from sessions outside the current workspace."
          control={
            <Checkbox
              checked={props.watchAllSessions}
              onChange={props.onToggleWatchAllSessions}
              label=""
            />
          }
        />
        <SettingsRow
          label="Instant Detection (Hooks)"
          helper="Use Claude Code hooks for instant agent state. Falls back to file polling if disabled."
          control={
            <Checkbox checked={props.hooksEnabled} onChange={props.onToggleHooksEnabled} label="" />
          }
        />
        <SettingsRow
          label="Default Terminal Folder"
          helper="Folder new agent terminals open in when no workspace is set. Supports ~."
          control={
            <PathInput
              value={props.defaultCwd}
              placeholder="~/Desktop"
              onCommit={props.onChangeDefaultCwd}
              ariaLabel="Default terminal folder"
            />
          }
        />
      </div>
    </div>
  );
}
