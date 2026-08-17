import { useState } from 'react';

import { SETTINGS_FONT_BODY_PX } from '../../../constants.js';

interface ListEditorProps {
  values: string[];
  placeholder?: string;
  ariaLabel?: string;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}

export function ListEditor({ values, placeholder, ariaLabel, onAdd, onRemove }: ListEditorProps) {
  const [draft, setDraft] = useState('');
  return (
    <div aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {values.map((v) => (
          <li
            key={v}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: SETTINGS_FONT_BODY_PX,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
            <button
              type="button"
              onClick={() => onRemove(v)}
              aria-label={`Remove ${v}`}
              style={{
                background: 'var(--pixel-bg)',
                border: '2px solid var(--pixel-border)',
                padding: '0 8px',
                fontSize: SETTINGS_FONT_BODY_PX,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            background: 'var(--pixel-bg)',
            color: 'inherit',
            border: '2px solid var(--pixel-border)',
            padding: '4px 8px',
            fontSize: SETTINGS_FONT_BODY_PX,
            flex: 1,
          }}
        />
        <button
          type="button"
          onClick={() => {
            const v = draft.trim();
            if (!v) return;
            onAdd(v);
            setDraft('');
          }}
          style={{
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            padding: '4px 12px',
            fontSize: SETTINGS_FONT_BODY_PX,
            cursor: 'pointer',
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
