import { TERMINAL_FONT_SIZE_DEFAULT } from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import type { PanelPersistedState } from './panelTypes.js';
import { PanelPosition } from './panelTypes.js';

const STATE_KEY = 'pixelAgents.drawer'; // legacy key name retained for backwards-compat

interface PersistedShape {
  /** Legacy name retained on disk; in-memory we use `panelOpen`. */
  drawerOpen?: boolean;
  railHidden?: boolean;
  panelPosition?: PanelPosition;
  terminalFontSize?: number;
  userBandSizePx?: number;
}

interface RootShape {
  [STATE_KEY]?: PersistedShape;
}

const DEFAULT: PanelPersistedState = {
  panelOpen: false,
  railHidden: false,
  panelPosition: PanelPosition.BOTTOM,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  userBandSizePx: undefined,
};

function isPanelPosition(v: unknown): v is PanelPosition {
  return v === 'bottom' || v === 'left' || v === 'right';
}

export function loadPanelState(): PanelPersistedState {
  const raw = vscode.getState<RootShape>();
  const slice = raw?.[STATE_KEY];
  if (!slice || typeof slice !== 'object') return DEFAULT;
  return {
    panelOpen: !!slice.drawerOpen,
    railHidden: !!slice.railHidden,
    panelPosition: isPanelPosition(slice.panelPosition)
      ? slice.panelPosition
      : DEFAULT.panelPosition,
    terminalFontSize:
      typeof slice.terminalFontSize === 'number' && Number.isFinite(slice.terminalFontSize)
        ? slice.terminalFontSize
        : DEFAULT.terminalFontSize,
    userBandSizePx:
      typeof slice.userBandSizePx === 'number' && Number.isFinite(slice.userBandSizePx)
        ? slice.userBandSizePx
        : undefined,
  };
}

export function savePanelState(state: PanelPersistedState): void {
  const prev = vscode.getState<RootShape>() ?? {};
  const slice: PersistedShape = {
    drawerOpen: state.panelOpen,
    railHidden: state.railHidden,
    panelPosition: state.panelPosition,
    terminalFontSize: state.terminalFontSize,
    userBandSizePx: state.userBandSizePx,
  };
  vscode.setState({ ...prev, [STATE_KEY]: slice });
}
