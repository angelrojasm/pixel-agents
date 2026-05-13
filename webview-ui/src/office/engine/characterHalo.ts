import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_COLOR_WARNING,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
  FOCUS_HALO_WIDTH_PX,
} from '../../constants.js';

export interface FocusHaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
  /** True only when the focused agent has usePtyTerminal=on but the pty hasn't
   *  produced its first byte yet (TerminalPaneStub is showing). */
  ptyStubFocused?: boolean;
}

export interface FocusHaloStyle {
  color: string;
  dash: readonly number[];
  width: number;
}

/** Pure selector — picks halo color/dash/width for a single character.
 *  Returns null when no halo should render. */
export function getFocusHaloStyle(input: FocusHaloInput): FocusHaloStyle | null {
  // PTY stub state overrides everything when focused.
  if (input.isFocused && input.ptyStubFocused) {
    return {
      color: FOCUS_HALO_COLOR_WARNING,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Awaiting-user + focused: amber.
  if (input.isFocused && input.awaitingSince != null) {
    return {
      color: FOCUS_HALO_COLOR_AWAITING,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Active + focused: solid accent.
  if (input.isActive && input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Active + NOT focused: solid muted (peripheral cue).
  if (input.isActive && !input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_MUTED,
      dash: FOCUS_HALO_SOLID_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Idle + focused: dotted accent.
  if (input.isFocused) {
    return {
      color: FOCUS_HALO_COLOR_ACCENT,
      dash: FOCUS_HALO_DOTTED_DASH,
      width: FOCUS_HALO_WIDTH_PX,
    };
  }

  // Idle + not focused: no halo.
  return null;
}
