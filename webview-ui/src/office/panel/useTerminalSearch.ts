import type { SearchAddon } from '@xterm/addon-search';
import { useCallback, useEffect, useReducer, useRef } from 'react';

export interface SearchState {
  open: boolean;
  query: string;
  currentMatch: number;
  totalMatches: number;
}

export type SearchAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setQuery'; query: string }
  | { type: 'setResults'; currentMatch: number; totalMatches: number };

const INITIAL: SearchState = {
  open: false,
  query: '',
  currentMatch: 0,
  totalMatches: 0,
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true };
    case 'close':
      return { ...INITIAL };
    case 'setQuery':
      if (action.query === '') {
        return { ...state, query: '', currentMatch: 0, totalMatches: 0 };
      }
      return { ...state, query: action.query };
    case 'setResults':
      return { ...state, currentMatch: action.currentMatch, totalMatches: action.totalMatches };
  }
}

export interface UseTerminalSearchResult {
  state: SearchState;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  next: () => void;
  previous: () => void;
}

/**
 * Owns the search-bar state for a single TerminalPane. The caller passes a
 * ref to the live SearchAddon (created in TerminalPane's setup useEffect);
 * the hook subscribes to the addon's onDidChangeResults event to keep match
 * counters in sync, and exposes pure actions for the UI to call.
 */
export function useTerminalSearch(
  searchAddonRef: React.RefObject<SearchAddon | null>,
): UseTerminalSearchResult {
  const [state, dispatch] = useReducer(searchReducer, INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Subscribe to addon result events to update counters.
  useEffect(() => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    const sub = addon.onDidChangeResults((e) => {
      dispatch({
        type: 'setResults',
        currentMatch: e.resultIndex >= 0 ? e.resultIndex + 1 : 0,
        totalMatches: e.resultCount,
      });
    });
    return () => sub.dispose();
  }, [searchAddonRef]);

  const open = useCallback(() => dispatch({ type: 'open' }), []);
  const close = useCallback(() => {
    const addon = searchAddonRef.current;
    addon?.clearDecorations();
    dispatch({ type: 'close' });
  }, [searchAddonRef]);

  const setQuery = useCallback(
    (q: string) => {
      dispatch({ type: 'setQuery', query: q });
      const addon = searchAddonRef.current;
      if (!addon) return;
      if (q === '') {
        addon.clearDecorations();
      } else {
        addon.findNext(q, { incremental: true, decorations: undefined });
      }
    },
    [searchAddonRef],
  );

  const next = useCallback(() => {
    const addon = searchAddonRef.current;
    if (addon && stateRef.current.query) addon.findNext(stateRef.current.query);
  }, [searchAddonRef]);

  const previous = useCallback(() => {
    const addon = searchAddonRef.current;
    if (addon && stateRef.current.query) addon.findPrevious(stateRef.current.query);
  }, [searchAddonRef]);

  return { state, open, close, setQuery, next, previous };
}
