/** Visual mode of the panel band. */
export const PanelMode = {
  OPEN: 'open',
  RAIL: 'rail',
  PEEK: 'peek',
} as const;
export type PanelMode = (typeof PanelMode)[keyof typeof PanelMode];

/** Where the panel docks. */
export const PanelPosition = {
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
} as const;
export type PanelPosition = (typeof PanelPosition)[keyof typeof PanelPosition];

/** True when the panel uses the horizontal axis (bottom). */
export function isHorizontalAxis(p: PanelPosition): boolean {
  return p === PanelPosition.BOTTOM;
}

/** Minimal agent view for the panel UI. */
export interface AgentSummary {
  id: number;
  name: string;
  /** Palette index, used by AgentCell to show the sprite color. */
  palette: number;
  /** Hue shift in degrees (0 for the first 6 palettes). */
  hueShift: number;
  /** Tool/activity status glyph color hint. */
  status: 'active' | 'waiting' | 'idle';
}

/** Persisted per-webview slice. Lives in vscode.setState. */
export interface PanelPersistedState {
  panelOpen: boolean;
  railHidden: boolean;
  panelPosition: PanelPosition;
  terminalFontSize: number;
}

/** Full in-memory panel state. Only PanelPersistedState fields are persisted. */
export interface PanelState extends PanelPersistedState {
  focusedAgentId: number | null;
  /** True when edit mode is active. Overrides the visual to rail/peek. */
  isEditMode: boolean;
  /** Container width in CSS px (used for side-axis floor + open-size math). */
  viewportWidth: number;
  /** Container height in CSS px (used for bottom-axis floor + open-size math). */
  viewportHeight: number;
}
