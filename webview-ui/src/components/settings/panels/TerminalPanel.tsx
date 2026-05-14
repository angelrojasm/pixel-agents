import { Checkbox } from '../../ui/Checkbox.js';
import { RadioGroup } from '../controls/RadioGroup.js';
import { Select } from '../controls/Select.js';
import { Stepper } from '../controls/Stepper.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface TerminalPanelProps {
  usePtyTerminal: boolean;
  onToggleUsePtyTerminal: () => void;
  panelPosition: 'bottom' | 'left' | 'right';
  onChangePanelPosition: (p: 'bottom' | 'left' | 'right') => void;
  terminalFontFamily: string;
  onChangeTerminalFontFamily: (v: string) => void;
  terminalFontSize: number;
  onChangeTerminalFontSize: (v: number) => void;
  terminalLineHeight: number;
  onChangeTerminalLineHeight: (v: number) => void;
  onRestoreDefaults: () => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Terminal" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SettingsRow
          label="Use in-panel terminal"
          helper="Render Claude's terminal inside the panel instead of VS Code's terminal strip."
          hint="applies to new agents"
          control={
            <Checkbox
              checked={props.usePtyTerminal}
              onChange={props.onToggleUsePtyTerminal}
              label=""
            />
          }
        />
        <SettingsRow
          label="Panel position"
          control={
            <RadioGroup
              value={props.panelPosition}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'right', label: 'Right' },
                { value: 'left', label: 'Left' },
              ]}
              onChange={props.onChangePanelPosition}
              ariaLabel="Panel position"
            />
          }
        />
        <SettingsRow
          label="Font family"
          helper="Monospaced font used in the in-panel terminal."
          control={
            <Select
              value={props.terminalFontFamily}
              options={[
                { value: 'monospace', label: 'System default' },
                { value: "'Fira Code', monospace", label: 'Fira Code' },
                { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
                { value: "'Cascadia Mono', monospace", label: 'Cascadia Mono' },
                { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
              ]}
              onChange={props.onChangeTerminalFontFamily}
              ariaLabel="Terminal font family"
            />
          }
        />
        <SettingsRow
          label="Font size"
          control={
            <Stepper
              value={props.terminalFontSize}
              min={8}
              max={24}
              step={1}
              onChange={props.onChangeTerminalFontSize}
              ariaLabel="Terminal font size"
            />
          }
        />
        <SettingsRow
          label="Line height"
          control={
            <Stepper
              value={props.terminalLineHeight}
              min={0.8}
              max={2.0}
              step={0.1}
              onChange={props.onChangeTerminalLineHeight}
              ariaLabel="Terminal line height"
            />
          }
        />
      </div>
    </div>
  );
}
