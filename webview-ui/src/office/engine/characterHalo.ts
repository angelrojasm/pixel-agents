import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
  FOCUS_HALO_WIDTH_PX,
} from '../../constants.js';

export interface FocusHaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
}
export interface FocusHaloStyle {
  color: string;
  dash: readonly number[];
  width: number;
}

/** Style for the seat-anchored focus halo; null = no halo. Priority order matters. */
export function getFocusHaloStyle(input: FocusHaloInput): FocusHaloStyle | null {
  const { isActive, isFocused, awaitingSince } = input;
  if (isFocused && awaitingSince != null) {
    return {
      color: FOCUS_HALO_COLOR_AWAITING,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }
  if (isActive && isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }
  if (isActive) {
    return {
      color: FOCUS_HALO_COLOR_MUTED,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }
  if (isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_DOTTED_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }
  return null;
}
