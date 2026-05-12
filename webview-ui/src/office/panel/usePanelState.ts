import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { computePanelBand } from './panelLayout.js';
import { loadPanelState, savePanelState } from './panelPersistence.js';
import {
  closeAgent as closeAgentReducer,
  focusOrToggle as focusOrToggleReducer,
  setEditMode as setEditModeReducer,
  setPanelPosition as setPanelPositionReducer,
  setTerminalFontSize as setTerminalFontSizeReducer,
  setUserBandSizePx as setUserBandSizePxReducer,
  setViewportHeight as setViewportHeightReducer,
  setViewportWidth as setViewportWidthReducer,
  toggleRailHidden as toggleRailHiddenReducer,
} from './panelState.js';
import type { PanelPosition, PanelState } from './panelTypes.js';

export interface PanelApi {
  state: PanelState;
  band: ReturnType<typeof computePanelBand>;
  focusOrToggle(agentId: number): void;
  openForNewAgent(agentId: number): void;
  closeAgent(closedId: number, mostRecentOtherAgentId: number | null): void;
  toggleRailHidden(): void;
  collapse(): void;
  setPanelPosition(p: PanelPosition): void;
  setTerminalFontSize(n: number): void;
  setUserBandSizePx(px: number | undefined): void;
}

/**
 * Orchestrates panel state for one webview.
 *
 * @param containerRef element whose dimensions drive viewport-shrink safety.
 * @param isEditMode   external signal from the editor; forces visual collapse.
 */
export function usePanelState(
  containerRef: RefObject<HTMLElement | null>,
  isEditMode: boolean,
): PanelApi {
  const initial = useMemo<PanelState>(() => {
    const persisted = loadPanelState();
    return {
      ...persisted,
      focusedAgentId: null,
      isEditMode,
      viewportWidth:
        typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280,
      viewportHeight:
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial state only
  }, []);

  const [state, setState] = useState<PanelState>(initial);

  // Persist whenever any persisted slice field changes.
  const lastPersistedRef = useRef({
    panelOpen: initial.panelOpen,
    railHidden: initial.railHidden,
    panelPosition: initial.panelPosition,
    terminalFontSize: initial.terminalFontSize,
    userBandSizePx: initial.userBandSizePx,
  });
  useEffect(() => {
    const { panelOpen, railHidden, panelPosition, terminalFontSize, userBandSizePx } = state;
    const last = lastPersistedRef.current;
    if (
      last.panelOpen !== panelOpen ||
      last.railHidden !== railHidden ||
      last.panelPosition !== panelPosition ||
      last.terminalFontSize !== terminalFontSize ||
      last.userBandSizePx !== userBandSizePx
    ) {
      savePanelState({ panelOpen, railHidden, panelPosition, terminalFontSize, userBandSizePx });
      lastPersistedRef.current = {
        panelOpen,
        railHidden,
        panelPosition,
        terminalFontSize,
        userBandSizePx,
      };
    }
  }, [state]);

  // Mirror external edit-mode signal into state.
  useEffect(() => {
    setState((s) => (s.isEditMode === isEditMode ? s : setEditModeReducer(s, isEditMode)));
  }, [isEditMode]);

  // Track container width + height for viewport-shrink safety on either axis.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (w: number, h: number) =>
      setState((s) => {
        const next1 = setViewportWidthReducer(s, w);
        const next2 = setViewportHeightReducer(next1, h);
        return next2;
      });
    update(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        update(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const focusOrToggle = useCallback((agentId: number) => {
    setState((s) => focusOrToggleReducer(s, agentId));
  }, []);

  const openForNewAgent = useCallback((agentId: number) => {
    setState((s) => ({ ...s, panelOpen: true, focusedAgentId: agentId }));
  }, []);

  const closeAgent = useCallback((closedId: number, mostRecentOtherAgentId: number | null) => {
    setState((s) => closeAgentReducer(s, closedId, mostRecentOtherAgentId));
  }, []);

  const toggleRailHidden = useCallback(() => {
    setState((s) => toggleRailHiddenReducer(s));
  }, []);

  const collapse = useCallback(() => {
    setState((s) => (s.panelOpen ? { ...s, panelOpen: false } : s));
  }, []);

  const setPanelPosition = useCallback((p: PanelPosition) => {
    setState((s) => setPanelPositionReducer(s, p));
  }, []);

  const setTerminalFontSize = useCallback((n: number) => {
    setState((s) => setTerminalFontSizeReducer(s, n));
  }, []);

  const setUserBandSizePx = useCallback((px: number | undefined) => {
    setState((s) => setUserBandSizePxReducer(s, px));
  }, []);

  const band = useMemo(() => computePanelBand(state), [state]);

  return {
    state,
    band,
    focusOrToggle,
    openForNewAgent,
    closeAgent,
    toggleRailHidden,
    collapse,
    setPanelPosition,
    setTerminalFontSize,
    setUserBandSizePx,
  };
}
