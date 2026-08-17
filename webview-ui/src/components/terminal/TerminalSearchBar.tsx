import { useEffect, useRef } from 'react';

import { TERMINAL_SEARCH_BAR_HEIGHT_PX, TERMINAL_SEARCH_BAR_WIDTH_PX } from '../../constants.js';

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
  const matchColor =
    hasQuery && totalMatches === 0 ? 'var(--color-status-error)' : 'var(--color-text-muted)';
  const matchLabel = hasQuery ? `${currentMatch}/${totalMatches}` : '';

  return (
    <div
      className="absolute top-4 right-4 flex items-center gap-4 border-2 border-border bg-bg z-10 px-6"
      style={{ width: TERMINAL_SEARCH_BAR_WIDTH_PX, height: TERMINAL_SEARCH_BAR_HEIGHT_PX }}
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
        aria-label="Find in terminal"
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-text text-2xs"
      />
      <span
        aria-live="polite"
        className="text-2xs text-right"
        style={{ minWidth: 36, color: matchColor }}
      >
        {matchLabel}
      </span>
      <button
        type="button"
        onClick={onPrevious}
        className="bg-transparent border-none text-text-muted text-2xs cursor-pointer px-2 hover:text-text"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={onNext}
        className="bg-transparent border-none text-text-muted text-2xs cursor-pointer px-2 hover:text-text"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="bg-transparent border-none text-text-muted text-2xs cursor-pointer px-2 hover:text-text"
        title="Close search (Esc)"
        aria-label="Close search"
      >
        ×
      </button>
    </div>
  );
}
