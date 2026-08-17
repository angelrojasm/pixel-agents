import { SETTINGS_FONT_BODY_PX } from '../../../constants.js';

interface PathInputProps {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  onCommit: (v: string) => void;
}

export function PathInput({ value, placeholder, ariaLabel, onCommit }: PathInputProps) {
  return (
    <input
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      style={{
        background: 'var(--pixel-bg)',
        color: 'inherit',
        border: '2px solid var(--pixel-border)',
        padding: '4px 8px',
        fontSize: SETTINGS_FONT_BODY_PX,
        minWidth: 240,
      }}
    />
  );
}
