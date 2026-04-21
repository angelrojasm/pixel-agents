import {
  DRAWER_HEIGHT_MAX_PX,
  DRAWER_HEIGHT_RATIO,
  MIN_DRAWER_VIEWPORT_PX,
  PEEK_HEIGHT_PX,
  RAIL_HEIGHT_PX,
} from '../../constants.js';
import type { DrawerState } from './drawerTypes.js';
import { DrawerMode } from './drawerTypes.js';

export interface Band {
  mode: DrawerMode;
  bandHeight: number;
  canvasHeight: number;
}

function drawerBandHeight(viewportHeight: number): number {
  return Math.min(Math.round(viewportHeight * DRAWER_HEIGHT_RATIO), DRAWER_HEIGHT_MAX_PX);
}

function collapsedBand(railHidden: boolean): { mode: DrawerMode; bandHeight: number } {
  return railHidden
    ? { mode: DrawerMode.PEEK, bandHeight: PEEK_HEIGHT_PX }
    : { mode: DrawerMode.RAIL, bandHeight: RAIL_HEIGHT_PX };
}

export function computeBand(state: DrawerState): Band {
  const { drawerOpen, railHidden, isEditMode, viewportHeight } = state;

  const forceCollapsed = isEditMode || viewportHeight < MIN_DRAWER_VIEWPORT_PX;
  const effectivelyOpen = drawerOpen && !forceCollapsed;

  const { mode, bandHeight } = effectivelyOpen
    ? { mode: DrawerMode.OPEN, bandHeight: drawerBandHeight(viewportHeight) }
    : collapsedBand(railHidden);

  const canvasHeight = Math.max(0, viewportHeight - bandHeight);
  return { mode, bandHeight, canvasHeight };
}
