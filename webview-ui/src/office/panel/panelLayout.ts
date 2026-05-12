import {
  MIN_PANEL_VIEWPORT_PX_HORIZONTAL,
  MIN_PANEL_VIEWPORT_PX_VERTICAL,
  PANEL_BOTTOM_OPEN_MAX_PX,
  PANEL_BOTTOM_OPEN_RATIO,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_BOTTOM_USER_MAX_RESERVE,
  PANEL_SIDE_OPEN_MAX_PX,
  PANEL_SIDE_OPEN_RATIO,
  PANEL_SIDE_PEEK_PX,
  PANEL_SIDE_RAIL_PX,
  PANEL_SIDE_USER_MAX_RESERVE,
  PANEL_USER_MIN_PX,
} from '../../constants.js';
import type { PanelState } from './panelTypes.js';
import { isHorizontalAxis, PanelMode } from './panelTypes.js';

export interface Band {
  mode: PanelMode;
  /** Thickness of the panel band along its axis (height for bottom, width for sides). */
  bandSize: number;
  /** Remaining canvas width in CSS px. */
  canvasW: number;
  /** Remaining canvas height in CSS px. */
  canvasH: number;
}

function bottomOpenSize(viewportHeight: number): number {
  return Math.min(Math.round(viewportHeight * PANEL_BOTTOM_OPEN_RATIO), PANEL_BOTTOM_OPEN_MAX_PX);
}

function sideOpenSize(viewportWidth: number): number {
  return Math.min(Math.round(viewportWidth * PANEL_SIDE_OPEN_RATIO), PANEL_SIDE_OPEN_MAX_PX);
}

function collapsedBottom(railHidden: boolean): { mode: PanelMode; bandSize: number } {
  return railHidden
    ? { mode: PanelMode.PEEK, bandSize: PANEL_BOTTOM_PEEK_PX }
    : { mode: PanelMode.RAIL, bandSize: PANEL_BOTTOM_RAIL_PX };
}

function collapsedSide(railHidden: boolean): { mode: PanelMode; bandSize: number } {
  return railHidden
    ? { mode: PanelMode.PEEK, bandSize: PANEL_SIDE_PEEK_PX }
    : { mode: PanelMode.RAIL, bandSize: PANEL_SIDE_RAIL_PX };
}

function userBandClamp(
  userBandSizePx: number,
  horizontal: boolean,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const max = horizontal
    ? viewportHeight - PANEL_BOTTOM_USER_MAX_RESERVE
    : viewportWidth - PANEL_SIDE_USER_MAX_RESERVE;
  return Math.max(PANEL_USER_MIN_PX, Math.min(userBandSizePx, max));
}

export function computePanelBand(state: PanelState): Band {
  const { panelOpen, railHidden, isEditMode, panelPosition, viewportWidth, viewportHeight } = state;

  const horizontal = isHorizontalAxis(panelPosition);
  const dimAlong = horizontal ? viewportHeight : viewportWidth;
  const floor = horizontal ? MIN_PANEL_VIEWPORT_PX_VERTICAL : MIN_PANEL_VIEWPORT_PX_HORIZONTAL;
  const forceCollapsed = isEditMode || dimAlong < floor;
  const effectivelyOpen = panelOpen && !forceCollapsed;

  let mode: PanelMode;
  let bandSize: number;
  if (effectivelyOpen) {
    mode = PanelMode.OPEN;
    if (state.userBandSizePx != null) {
      bandSize = userBandClamp(state.userBandSizePx, horizontal, viewportWidth, viewportHeight);
    } else {
      bandSize = horizontal ? bottomOpenSize(viewportHeight) : sideOpenSize(viewportWidth);
    }
  } else {
    const collapsed = horizontal ? collapsedBottom(railHidden) : collapsedSide(railHidden);
    mode = collapsed.mode;
    bandSize = collapsed.bandSize;
  }

  const canvasW = horizontal ? viewportWidth : Math.max(0, viewportWidth - bandSize);
  const canvasH = horizontal ? Math.max(0, viewportHeight - bandSize) : viewportHeight;

  return { mode, bandSize, canvasW, canvasH };
}
