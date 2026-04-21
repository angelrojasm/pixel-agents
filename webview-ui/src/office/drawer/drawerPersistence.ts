import { vscode } from '../../vscodeApi.js';
import type { DrawerPersistedState } from './drawerTypes.js';

const STATE_KEY = 'pixelAgents.drawer';

interface Persisted {
  [STATE_KEY]?: DrawerPersistedState;
}

const DEFAULT: DrawerPersistedState = {
  drawerOpen: false,
  railHidden: false,
};

export function loadDrawerState(): DrawerPersistedState {
  const raw = vscode.getState<Persisted>();
  const slice = raw?.[STATE_KEY];
  if (!slice || typeof slice !== 'object') return DEFAULT;
  return {
    drawerOpen: !!slice.drawerOpen,
    railHidden: !!slice.railHidden,
  };
}

export function saveDrawerState(state: DrawerPersistedState): void {
  const prev = vscode.getState<Persisted>() ?? {};
  vscode.setState({ ...prev, [STATE_KEY]: state });
}
