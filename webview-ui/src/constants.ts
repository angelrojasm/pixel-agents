import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
// Short pause used immediately after leaving a seat so the character steps off
// the chair tile quickly instead of standing on it for WANDER_PAUSE_MAX_SEC.
export const STEP_OFF_PAUSE_MIN_SEC = 0.3;
export const STEP_OFF_PAUSE_MAX_SEC = 0.8;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
/** Valid zoom values in order. Half-steps allowed; the integer-DPR invariant
 *  is intentionally relaxed at half-steps (may shimmer at DPR<2 — accepted tradeoff). */
export const ZOOM_STEPS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10,
] as const;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;

// ── Agent Teams ─────────────────────────────────────────────
export const MAX_CONTEXT_TOKENS = 200_000;
export const TOKEN_WARN_THRESHOLD = 0.6;
export const TOKEN_DANGER_THRESHOLD = 0.8;

// Settings modal layout constants
export const SETTINGS_MODAL_WIDTH_PX = 720;
export const SETTINGS_MODAL_HEIGHT_PX = 520;
export const SETTINGS_SIDEBAR_WIDTH_PX = 160;
export const SETTINGS_TITLE_STRIP_HEIGHT_PX = 32;
// Settings undo toast duration
export const SETTINGS_UNDO_TOAST_MS = 5000;
export const TOKEN_CRITICAL_THRESHOLD = 0.95;
export const FUEL_GAUGE_WIDTH_PX = 40;
export const FUEL_GAUGE_HEIGHT_PX = 4;
export const FUEL_COLOR_OK = '#44cc44';
export const FUEL_COLOR_WARN = '#ffcc00';
export const FUEL_COLOR_DANGER = '#ff8800';
export const FUEL_COLOR_CRITICAL = '#ff2222';
export const FUEL_GAUGE_BG = '#222';
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── Office Panel (Phase 2 UX shell, configurable position) ───
/** Bottom panel sizing. */
export const PANEL_BOTTOM_OPEN_RATIO = 0.4; // fraction of viewport height
export const PANEL_BOTTOM_OPEN_MAX_PX = 320;
export const PANEL_BOTTOM_RAIL_PX = 28;
export const PANEL_BOTTOM_PEEK_PX = 6;
/** Side (left/right) panel sizing. */
export const PANEL_SIDE_OPEN_RATIO = 0.4; // fraction of viewport width
export const PANEL_SIDE_OPEN_MAX_PX = 360;
export const PANEL_SIDE_RAIL_PX = 32;
export const PANEL_SIDE_PEEK_PX = 6;
/** Viewport-floor checks per axis. */
export const MIN_PANEL_VIEWPORT_PX_VERTICAL = 360; // bottom panel needs this much height
export const MIN_PANEL_VIEWPORT_PX_HORIZONTAL = 480; // side panel needs this much width
/** Panel header (focused-agent frame + tab strip + actions) thickness. */
export const PANEL_HEADER_THICKNESS_PX = 22;

/** Terminal font size (xterm.js will consume the same value once D2 lands). */
export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 24;

/** User-resize bounds for the open panel band. Applied as a clamp on userBandSizePx. */
export const PANEL_USER_MIN_PX = 240;
/** Reserved canvas height when the panel is on the bottom (minimum room above the panel). */
export const PANEL_BOTTOM_USER_MAX_RESERVE = 200;
/** Reserved canvas width when the panel is on a side (minimum room next to the panel). */
export const PANEL_SIDE_USER_MAX_RESERVE = 360;

// Panel chrome colors (centralized — file is exempt from no-inline-colors).
export const PANEL_BG_CHROME = '#0a0a14';
export const PANEL_BG_CELL = '#1e1e2e';
export const PANEL_BORDER = '#4a4a6e';
export const PANEL_ACCENT = '#4ade80';
export const PANEL_MUTED = '#6b7280';
export const PANEL_WAITING = '#f59e0b';
export const PANEL_SPRITE_PLACEHOLDER = '#f5c2a7';

// ── Character Nameplate ──────────────────────────────────────
export const NAMEPLATE_TEXT_COLOR = '#dcd6ec';
export const NAMEPLATE_TEXT_OUTLINE = '0 0 2px #000, 0 0 4px rgba(0, 0, 0, 0.8)';

// ── Terminal ↔ Character Interaction ────────────────────────
// Focus halo
export const FOCUS_HALO_WIDTH_PX = 2;
export const FOCUS_HALO_INSET_PX = 2;
export const FOCUS_HALO_DOTTED_DASH: [number, number] = [1, 1];
export const FOCUS_HALO_SOLID_DASH: number[] = [];
export const FOCUS_HALO_COLOR_ACCENT = PANEL_ACCENT;
export const FOCUS_HALO_COLOR_MUTED = PANEL_MUTED;
export const FOCUS_HALO_COLOR_AWAITING = PANEL_WAITING;

// Crashed glyph
export const CRASHED_GLYPH_SIZE_PX = 5;
export const CRASHED_GLYPH_OFFSET_X_PX = TILE_SIZE - 6;
export const CRASHED_GLYPH_OFFSET_Y_PX = -6;
export const CRASHED_GLYPH_BG = 'var(--color-danger)';
export const CRASHED_GLYPH_BORDER = PANEL_BG_CHROME;
export const CRASHED_DESATURATION_PCT = 60;

// Sub-agent parent-link line
export const SUBAGENT_LINK_DASH: [number, number] = [2, 2];
export const SUBAGENT_LINK_WIDTH_PX = 1;
export const SUBAGENT_LINK_FLASH_DURATION_MS = 250;
export const SUBAGENT_LINK_COLOR = PANEL_MUTED;

// PTY → animation timing
export const PTY_ACTIVITY_HOLD_MS = 200;
export const PTY_SILENCE_TO_READING_MS = 1000;

// Hook-health UI
export const HOOK_HEALTH_DOT_SIZE_PX = 4;
export const HOOK_HEALTH_TOAST_DURATION_MS = 0;
export const HOOK_HEALTH_DOT_COLOR_DOWN = 'var(--color-danger)';
export const HOOK_HEALTH_DOT_COLOR_DEGRADED = 'var(--color-warning)';
