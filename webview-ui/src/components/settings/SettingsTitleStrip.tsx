import {
  SETTINGS_FONT_LABEL_PX,
  SETTINGS_FONT_META_PX,
  SETTINGS_TITLE_STRIP_HEIGHT_PX,
} from '../../constants.js';

interface SettingsTitleStripProps {
  title: string;
  onRestoreDefaults: () => void;
}

export function SettingsTitleStrip({ title, onRestoreDefaults }: SettingsTitleStripProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--pixel-accent)',
        minHeight: SETTINGS_TITLE_STRIP_HEIGHT_PX,
        padding: '6px 12px',
        borderBottom: '2px solid var(--pixel-border)',
      }}
    >
      <span style={{ fontWeight: 'bold', fontSize: SETTINGS_FONT_LABEL_PX }}>{title}</span>
      <button
        type="button"
        onClick={onRestoreDefaults}
        aria-label={`Restore ${title} defaults`}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: SETTINGS_FONT_META_PX,
          padding: '2px 8px',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        Restore Defaults
      </button>
    </div>
  );
}
