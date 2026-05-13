import { useEffect, useRef } from 'react';

import { PANEL_ACCENT, PANEL_BG_CELL, PANEL_BORDER, PANEL_MUTED } from '../../constants.js';

interface TerminalSearchBarProps {
  query: string;
  currentMatch: number;
  totalMatches: number;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function TerminalSearchBar({
  query,
  currentMatch,
  totalMatches,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the bar mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasQuery = query.length > 0;
  const matchColor = hasQuery && totalMatches === 0 ? 'var(--color-status-error)' : PANEL_MUTED;
  const matchLabel = hasQuery ? `${currentMatch}/${totalMatches}` : '';

  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        width: 240,
        height: 22,
        background: PANEL_BG_CELL,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px',
        zIndex: 5,
        fontSize: 10,
      }}
      role="search"
      aria-label="Search terminal"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="find"
        aria-label="Search terminal"
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: PANEL_ACCENT,
          fontSize: 10,
        }}
      />
      <span
        aria-live="polite"
        style={{
          color: matchColor,
          fontSize: 10,
          minWidth: 36,
          textAlign: 'right',
        }}
      >
        {matchLabel}
      </span>
      <button
        type="button"
        onClick={onPrevious}
        className="panel-icon-hover"
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 2px',
        }}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={onNext}
        className="panel-icon-hover"
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 2px',
        }}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="panel-icon-hover"
        style={{
          background: 'transparent',
          border: 'none',
          color: PANEL_MUTED,
          fontSize: 10,
          cursor: 'pointer',
          padding: '0 2px',
        }}
        title="Close search (Esc)"
        aria-label="Close search"
      >
        ×
      </button>
    </div>
  );
}
