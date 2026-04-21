import type { DrawerState } from './drawerTypes.js';

export function focusOrToggle(state: DrawerState, agentId: number): DrawerState {
  if (state.drawerOpen && state.focusedAgentId === agentId) {
    return { ...state, drawerOpen: false };
  }
  return { ...state, drawerOpen: true, focusedAgentId: agentId };
}

export function closeAgent(
  state: DrawerState,
  closedId: number,
  mostRecentOtherAgentId: number | null,
): DrawerState {
  if (state.focusedAgentId !== closedId) return state;
  if (mostRecentOtherAgentId == null) {
    return { ...state, focusedAgentId: null, drawerOpen: false };
  }
  return { ...state, focusedAgentId: mostRecentOtherAgentId };
}

export function toggleRailHidden(state: DrawerState): DrawerState {
  return { ...state, railHidden: !state.railHidden };
}

export function setEditMode(state: DrawerState, isEditMode: boolean): DrawerState {
  return { ...state, isEditMode };
}

export function setViewportHeight(state: DrawerState, viewportHeight: number): DrawerState {
  return { ...state, viewportHeight };
}
