import { Checkbox } from '../../ui/Checkbox.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface GeneralPanelProps {
  soundEnabled: boolean;
  onToggleSound: () => void;
  alwaysShowLabels: boolean;
  onToggleAlwaysShowLabels: () => void;
  showTerminalNames: boolean;
  onToggleShowTerminalNames: () => void;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  onRestoreDefaults: () => void;
}

export function GeneralPanel(props: GeneralPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="General" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Sound Notifications"
          helper="Plays a short chime when an agent is waiting for input."
          control={
            <Checkbox checked={props.soundEnabled} onChange={props.onToggleSound} label="" />
          }
        />
        <SettingsRow
          label="Always Show Labels"
          helper="Keep character name labels visible at all times (not only on hover)."
          control={
            <Checkbox
              checked={props.alwaysShowLabels}
              onChange={props.onToggleAlwaysShowLabels}
              label=""
            />
          }
        />
        <SettingsRow
          label="Show Terminal Names"
          helper="Display the underlying VS Code terminal name on each character."
          control={
            <Checkbox
              checked={props.showTerminalNames}
              onChange={props.onToggleShowTerminalNames}
              label=""
            />
          }
        />
        <SettingsRow
          label="Debug View"
          helper="Overlay diagnostic information on top of the office canvas."
          control={
            <Checkbox checked={props.debugMode} onChange={props.onToggleDebugMode} label="" />
          }
        />
      </div>
    </div>
  );
}
