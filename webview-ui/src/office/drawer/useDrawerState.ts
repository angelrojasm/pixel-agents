import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { computeBand } from './drawerLayout.js';
import { loadDrawerState, saveDrawerState } from './drawerPersistence.js';
import {
  closeAgent as closeAgentReducer,
  focusOrToggle as focusOrToggleReducer,
  setEditMode as setEditModeReducer,
  setViewportHeight as setViewportHeightReducer,
  toggleRailHidden as toggleRailHiddenReducer,
} from './drawerState.js';
import type { DrawerState } from './drawerTypes.js';

export interface DrawerApi {
  state: DrawerState;
  band: ReturnType<typeof computeBand>;
  focusOrToggle(agentId: number): void;
  openForNewAgent(agentId: number): void;
  closeAgent(closedId: number, mostRecentOtherAgentId: number | null): void;
  toggleRailHidden(): void;
  collapse(): void;
}

/**
 * Orchestrates drawer state for one webview.
 *
 * @param containerRef element whose height drives viewport-shrink safety.
 * @param isEditMode   external signal from the editor; forces visual collapse.
 */
export function useDrawerState(
  containerRef: RefObject<HTMLElement | null>,
  isEditMode: boolean,
): DrawerApi {
  const initial = useMemo<DrawerState>(() => {
    const persisted = loadDrawerState();
    return {
      ...persisted,
      focusedAgentId: null,
      isEditMode,
      viewportHeight:
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial state only
  }, []);

  const [state, setState] = useState<DrawerState>(initial);

  // Persist `drawerOpen` + `railHidden` whenever they change.
  const lastPersistedRef = useRef<{ drawerOpen: boolean; railHidden: boolean }>({
    drawerOpen: initial.drawerOpen,
    railHidden: initial.railHidden,
  });
  useEffect(() => {
    const { drawerOpen, railHidden } = state;
    const last = lastPersistedRef.current;
    if (last.drawerOpen !== drawerOpen || last.railHidden !== railHidden) {
      saveDrawerState({ drawerOpen, railHidden });
      lastPersistedRef.current = { drawerOpen, railHidden };
    }
  }, [state]);

  // Mirror external edit-mode signal into state (affects band computation).
  useEffect(() => {
    setState((s) => (s.isEditMode === isEditMode ? s : setEditModeReducer(s, isEditMode)));
  }, [isEditMode]);

  // Track container height for viewport-shrink safety.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (h: number) =>
      setState((s) => (s.viewportHeight === h ? s : setViewportHeightReducer(s, h)));
    update(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const focusOrToggle = useCallback((agentId: number) => {
    setState((s) => focusOrToggleReducer(s, agentId));
  }, []);

  const openForNewAgent = useCallback((agentId: number) => {
    // Always set open on + Agent; computeBand enforces the viewport-shrink override.
    setState((s) => ({ ...s, drawerOpen: true, focusedAgentId: agentId }));
  }, []);

  const closeAgent = useCallback((closedId: number, mostRecentOtherAgentId: number | null) => {
    setState((s) => closeAgentReducer(s, closedId, mostRecentOtherAgentId));
  }, []);

  const toggleRailHidden = useCallback(() => {
    setState((s) => toggleRailHiddenReducer(s));
  }, []);

  const collapse = useCallback(() => {
    setState((s) => (s.drawerOpen ? { ...s, drawerOpen: false } : s));
  }, []);

  const band = useMemo(() => computeBand(state), [state]);

  return { state, band, focusOrToggle, openForNewAgent, closeAgent, toggleRailHidden, collapse };
}
