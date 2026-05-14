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
        <span style={{ fontWeight: 'bold', fontSize: 13 }}>About</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SettingsRow
          label="Version"
          control={<span style={{ fontSize: 12 }}>{extensionVersion || 'unknown'}</span>}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onViewChangelog}>View changelog</Button>
          <Button onClick={onViewHooksInfo}>Hooks info</Button>
        </div>
      </div>
    </div>
  );
}
