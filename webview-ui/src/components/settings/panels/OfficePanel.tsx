import { Button } from '../../ui/Button.js';
import { ListEditor } from '../controls/ListEditor.js';
import { SettingsRow } from '../SettingsRow.js';
import { SettingsTitleStrip } from '../SettingsTitleStrip.js';

interface OfficePanelProps {
  externalAssetDirectories: string[];
  onAddAssetDirectory: (path: string) => void;
  onRemoveAssetDirectory: (path: string) => void;
  onExportLayout: () => void;
  onImportLayout: () => void;
  onRestoreDefaults: () => void;
}

export function OfficePanel(props: OfficePanelProps) {
  return (
    <div>
      <SettingsTitleStrip title="Office" onRestoreDefaults={props.onRestoreDefaults} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettingsRow
          label="External Asset Directories"
          helper="Folders containing extra furniture/character PNGs and catalog files."
          control={
            <ListEditor
              values={props.externalAssetDirectories}
              placeholder="/path/to/asset/pack"
              onAdd={props.onAddAssetDirectory}
              onRemove={props.onRemoveAssetDirectory}
              ariaLabel="External asset directories"
            />
          }
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={props.onExportLayout}>Export layout</Button>
          <Button onClick={props.onImportLayout}>Import layout</Button>
        </div>
      </div>
    </div>
  );
}
