import type { ReactNode } from 'react';

import {
  SETTINGS_FONT_BODY_PX,
  SETTINGS_FONT_LABEL_PX,
  SETTINGS_FONT_META_PX,
} from '../../constants.js';

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
        <div style={{ fontSize: SETTINGS_FONT_LABEL_PX }}>{label}</div>
        {helper && (
          <div style={{ fontSize: SETTINGS_FONT_BODY_PX, opacity: 0.8, marginTop: 2 }}>
            {helper}
          </div>
        )}
        {hint && (
          <div
            style={{
              fontSize: SETTINGS_FONT_META_PX,
              opacity: 0.6,
              marginTop: 2,
              fontStyle: 'italic',
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>{control}</div>
    </div>
  );
}
