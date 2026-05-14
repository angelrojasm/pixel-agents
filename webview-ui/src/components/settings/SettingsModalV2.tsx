import { useCallback, useEffect,useState } from 'react';

import type { SettingsCategory } from '../../../../src/constants.js';
import {
  SETTINGS_MODAL_HEIGHT_PX,
  SETTINGS_MODAL_WIDTH_PX,
  SETTINGS_SIDEBAR_WIDTH_PX,
} from '../../constants.js';

interface SettingsModalV2Props {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: { id: SettingsCategory | 'about'; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'office', label: 'Office' },
  { id: 'about', label: 'About' },
];

export function SettingsModalV2({ isOpen, onClose }: SettingsModalV2Props) {
  const [active, setActive] = useState<(typeof CATEGORIES)[number]['id']>('general');

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
        e.preventDefault();
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onKey]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="settings-title"
      onClick={onClose}
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: SETTINGS_MODAL_WIDTH_PX,
          height: SETTINGS_MODAL_HEIGHT_PX,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          boxShadow: '2px 2px 0px var(--pixel-border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '2px solid var(--pixel-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span id="settings-title" style={{ fontWeight: 'bold' }}>
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <nav
            role="tablist"
            aria-orientation="vertical"
            style={{
              width: SETTINGS_SIDEBAR_WIDTH_PX,
              borderRight: '2px solid var(--pixel-border)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={active === c.id}
                onClick={() => setActive(c.id)}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  borderLeft:
                    active === c.id ? '2px solid var(--pixel-accent)' : '2px solid transparent',
                  fontWeight: active === c.id ? 'bold' : 'normal',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <main role="tabpanel" style={{ flex: 1, padding: 0, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ padding: 16 }}>
              {active === 'general' && <div>General panel placeholder</div>}
              {active === 'agents' && <div>Agents panel placeholder</div>}
              {active === 'terminal' && <div>Terminal panel placeholder</div>}
              {active === 'office' && <div>Office panel placeholder</div>}
              {active === 'about' && <div>About panel placeholder</div>}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
