import { SETTINGS_FONT_BODY_PX, SETTINGS_FONT_LABEL_PX } from '../../../constants.js';
import { Button } from '../../ui/Button.js';
import { SettingsRow } from '../SettingsRow.js';

interface AboutPanelProps {
  extensionVersion: string;
  onViewChangelog: () => void;
  onViewHooksInfo: () => void;
}

export function AboutPanel({
  extensionVersion,
  onViewChangelog,
  onViewHooksInfo,
}: AboutPanelProps) {
  return (
    <div>
      <div
        style={{
          background: 'var(--pixel-accent)',
          padding: '6px 12px',
          borderBottom: '2px solid var(--pixel-border)',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: SETTINGS_FONT_LABEL_PX }}>About</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettingsRow
          label="Version"
          control={
            <span style={{ fontSize: SETTINGS_FONT_BODY_PX }}>{extensionVersion || 'unknown'}</span>
          }
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onViewChangelog}>View changelog</Button>
          <Button onClick={onViewHooksInfo}>Hooks info</Button>
        </div>
      </div>
    </div>
  );
}
