import { useEffect } from 'react';

import { SETTINGS_UNDO_TOAST_MS } from '../../constants.js';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = SETTINGS_UNDO_TOAST_MS,
}: UndoToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        boxShadow: '2px 2px 0px var(--pixel-border)',
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          background: 'var(--pixel-accent)',
          border: '2px solid var(--pixel-border)',
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        Undo
      </button>
    </div>
  );
}
