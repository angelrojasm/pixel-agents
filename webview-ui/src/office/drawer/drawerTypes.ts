/** Visual mode of the bottom band. */
export const DrawerMode = {
  OPEN: 'open',
  RAIL: 'rail',
  PEEK: 'peek',
} as const;
export type DrawerMode = (typeof DrawerMode)[keyof typeof DrawerMode];

/** Minimal agent view for the drawer UI. */
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
export interface DrawerPersistedState {
  drawerOpen: boolean;
  railHidden: boolean;
}

/** Full in-memory drawer state. Only DrawerPersistedState is persisted. */
export interface DrawerState extends DrawerPersistedState {
  focusedAgentId: number | null;
  /** True when edit mode is active. Overrides the visual to rail/peek. */
  isEditMode: boolean;
  /** Current viewport height in CSS px. Below MIN_DRAWER_VIEWPORT_PX, band is forced. */
  viewportHeight: number;
}
