import { useRef } from 'react';

import { SETTINGS_SIDEBAR_WIDTH_PX } from '../../constants.js';

export type SettingsCategoryId = 'general' | 'agents' | 'terminal' | 'office' | 'about';

interface SettingsSidebarProps {
  categories: { id: SettingsCategoryId; label: string }[];
  active: SettingsCategoryId;
  onChange: (id: SettingsCategoryId) => void;
}

export function SettingsSidebar({ categories, active, onChange }: SettingsSidebarProps) {
  const navRef = useRef<HTMLElement>(null);

  function onKey(e: React.KeyboardEvent<HTMLElement>) {
    const idx = categories.findIndex((c) => c.id === active);
    if (e.key === 'ArrowDown') {
      const next = categories[(idx + 1) % categories.length];
      onChange(next.id);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const next = categories[(idx - 1 + categories.length) % categories.length];
      onChange(next.id);
      e.preventDefault();
    }
  }

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={onKey}
      style={{
        width: SETTINGS_SIDEBAR_WIDTH_PX,
        borderRight: '2px solid var(--pixel-border)',
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
      }}
    >
      {categories.map((c) => (
        <button
          key={c.id}
          id={`settings-tab-${c.id}`}
          role="tab"
          aria-selected={active === c.id}
          aria-controls={`settings-panel-${c.id}`}
          tabIndex={-1}
          onClick={() => onChange(c.id)}
          style={{
            textAlign: 'left',
            padding: '8px 12px',
            borderLeft: active === c.id ? '2px solid var(--pixel-accent)' : '2px solid transparent',
            fontWeight: active === c.id ? 'bold' : 'normal',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            outline: 'none',
          }}
        >
          {c.label}
        </button>
      ))}
    </nav>
  );
}
