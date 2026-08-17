import { useEffect, useRef, useState } from 'react';

import {
  SETTINGS_FONT_BODY_PX,
  SETTINGS_FONT_LABEL_PX,
  SETTINGS_FONT_META_PX,
} from '../constants.js';
import type { NewAgentSpawn } from './newAgentSpawn.js';
import { buildSpawnRequest } from './newAgentSpawn.js';
import { Button } from './ui/Button.js';

export type { NewAgentSpawn };

interface NewAgentPopoverProps {
  /** Prefill for the folder field ('' = spawn with the default cwd chain). */
  defaultCwd: string;
  /** MRU list from settingsLoaded (config.json), newest first. */
  recentFolders: string[];
  onSpawn: (spawn: NewAgentSpawn) => void;
  onClose: () => void;
}

/** "New agent" form — opened from the + Agent hover menu. Both fields are
 *  optional; blank means the same defaults the plain + Agent click uses. */
export function NewAgentPopover({
  defaultCwd,
  recentFolders,
  onSpawn,
  onClose,
}: NewAgentPopoverProps) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultCwd);
  const [bypass, setBypass] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const spawn = () => {
    onSpawn(buildSpawnRequest(name, folder, defaultCwd, bypass));
  };

  const inputStyle: React.CSSProperties = {
    fontSize: SETTINGS_FONT_BODY_PX,
    width: '100%',
    boxSizing: 'border-box',
    padding: '6px 8px',
    background: 'var(--color-bg-dark)',
    border: '2px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 0,
    outline: 'none',
  };

  return (
    <div
      className="pixel-panel"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 8,
        width: 340,
        padding: 12,
        zIndex: 30,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') spawn();
      }}
    >
      <div style={{ fontSize: SETTINGS_FONT_LABEL_PX, marginBottom: 10 }}>New agent</div>

      <label
        style={{ display: 'block', fontSize: SETTINGS_FONT_META_PX, opacity: 0.8, marginBottom: 4 }}
      >
        Name (optional)
      </label>
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Research Bot"
        aria-label="Agent name"
        style={{ ...inputStyle, marginBottom: 10 }}
      />

      <label
        style={{ display: 'block', fontSize: SETTINGS_FONT_META_PX, opacity: 0.8, marginBottom: 4 }}
      >
        Starting folder (~ supported)
      </label>
      <input
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
        placeholder="default folder"
        aria-label="Starting folder"
        style={{ ...inputStyle, marginBottom: recentFolders.length ? 6 : 10 }}
      />

      {recentFolders.length > 0 && (
        <div
          style={{ marginBottom: 10, maxHeight: 120, overflowY: 'auto' }}
          className="pixel-scrollbar"
        >
          {recentFolders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFolder(f)}
              title={f}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                fontSize: SETTINGS_FONT_META_PX,
                padding: '3px 6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              className="panel-cell-hover"
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: SETTINGS_FONT_META_PX,
          opacity: 0.8,
          marginBottom: 10,
          cursor: 'pointer',
        }}
      >
        <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
        Skip permissions mode <span className="text-warning">⚠</span>
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="accent" onClick={spawn}>
          Spawn
        </Button>
      </div>
    </div>
  );
}
