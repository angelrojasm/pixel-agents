import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  helper?: string;
  control: ReactNode;
  hint?: string;
}

export function SettingsRow({ label, helper, control, hint }: SettingsRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 16,
        alignItems: 'start',
        paddingBlock: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 12 }}>{label}</div>
        {helper && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{helper}</div>}
        {hint && (
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, fontStyle: 'italic' }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>{control}</div>
    </div>
  );
}
