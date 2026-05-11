import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../../constants.js';
import type { PanelPosition, PanelState } from './panelTypes.js';

export function focusOrToggle(state: PanelState, agentId: number): PanelState {
  if (state.panelOpen && state.focusedAgentId === agentId) {
    return { ...state, panelOpen: false };
  }
  return { ...state, panelOpen: true, focusedAgentId: agentId };
}

export function closeAgent(
  state: PanelState,
  closedId: number,
  mostRecentOtherAgentId: number | null,
): PanelState {
  if (state.focusedAgentId !== closedId) return state;
  if (mostRecentOtherAgentId == null) {
    return { ...state, focusedAgentId: null, panelOpen: false };
  }
  return { ...state, focusedAgentId: mostRecentOtherAgentId };
}

export function toggleRailHidden(state: PanelState): PanelState {
  return { ...state, railHidden: !state.railHidden };
}

export function setEditMode(state: PanelState, isEditMode: boolean): PanelState {
  return { ...state, isEditMode };
}

export function setViewportWidth(state: PanelState, viewportWidth: number): PanelState {
  return state.viewportWidth === viewportWidth ? state : { ...state, viewportWidth };
}

export function setViewportHeight(state: PanelState, viewportHeight: number): PanelState {
  return state.viewportHeight === viewportHeight ? state : { ...state, viewportHeight };
}

export function setPanelPosition(state: PanelState, position: PanelPosition): PanelState {
  return state.panelPosition === position ? state : { ...state, panelPosition: position };
}

export function setTerminalFontSize(state: PanelState, size: number): PanelState {
  const clamped = Math.max(
    TERMINAL_FONT_SIZE_MIN,
    Math.min(TERMINAL_FONT_SIZE_MAX, Math.round(size)),
  );
  return state.terminalFontSize === clamped ? state : { ...state, terminalFontSize: clamped };
}
