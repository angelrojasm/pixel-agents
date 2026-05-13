import { useEffect, useState } from 'react';

import { PANEL_BG_CELL, PANEL_BG_CHROME, PANEL_BORDER, PANEL_MUTED } from '../../constants.js';

interface HookHealthToastProps {
  status: 'ok' | 'degraded' | 'down';
  reason?: string;
}

/**
 * Sticky toast that appears when hook health is `down`. Shows the reason and a
 * dismiss button. Dismissal is per-session — when status returns to `ok` and
 * later drops back to `down`, the toast re-appears.
 */
export function HookHealthToast({ status, reason }: HookHealthToastProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when status recovers to ok (so a fresh down re-shows).
  useEffect(() => {
    if (status === 'ok') setDismissed(false);
  }, [status]);

  if (status !== 'down' || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: PANEL_BG_CELL,
        color: PANEL_MUTED,
        border: `2px solid ${PANEL_BORDER}`,
        boxShadow: `2px 2px 0px ${PANEL_BG_CHROME}`,
        padding: '8px 12px',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        zIndex: 1000,
        borderRadius: 0,
      }}
    >
      <span style={{ color: 'var(--color-danger)' }}>●</span>
      <span>Hook server: {reason ?? 'unreachable'}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="panel-icon-hover"
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 11,
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
