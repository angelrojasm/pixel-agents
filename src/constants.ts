// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const CONFIG_FILE_NAME = 'config.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';

// ── Settings Persistence (VS Code globalState keys) ─────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
export const GLOBAL_KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
export const GLOBAL_KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
export const GLOBAL_KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
export const GLOBAL_KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
export const GLOBAL_KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';
export const GLOBAL_KEY_SHOW_TERMINAL_NAMES = 'pixel-agents.showTerminalNames';
export const GLOBAL_KEY_DEFAULT_CWD = 'pixel-agents.defaultCwd';
export const GLOBAL_KEY_RECENT_AGENT_FOLDERS = 'pixel-agents.recentAgentFolders';
/** MRU cap for the New-agent form's recent folders list. */
export const RECENT_AGENT_FOLDERS_MAX = 8;
export const GLOBAL_KEY_TERMINAL_FONT_FAMILY = 'pixel-agents.terminalFontFamily';
export const GLOBAL_KEY_TERMINAL_LINE_HEIGHT = 'pixel-agents.terminalLineHeight';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_OPEN_FULL_SCREEN = 'pixel-agents.openFullScreen';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const COMMAND_EXPORT_SETTINGS = 'pixel-agents.exportSettings';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';

// ── Terminal Name Polling ────────────────────────────────────
export const TERMINAL_NAME_POLL_INTERVAL_MS = 2000;

/** Canonical default values for every user-facing setting. Source of truth for
 *  both the `globalState.get(KEY, default)` sites and the per-category
 *  "Restore Defaults" flow. State-tracking flags (hooksInfoShown,
 *  lastSeenVersion, etc.) are NOT settings and are not represented here. */
export const DEFAULT_SETTINGS = {
  general: {
    soundEnabled: true,
    alwaysShowLabels: false,
    showTerminalNames: true,
    debugMode: false,
  },
  agents: {
    watchAllSessions: false,
    hooksEnabled: true,
    defaultCwd: '',
  },
  // Note: panelPosition and fontSize are webview-local (panelPersistence) and not in this constant.
  terminal: {
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: 1.0,
  },
  office: {
    externalAssetDirectories: [] as string[],
  },
} as const;

export type SettingsCategory = keyof typeof DEFAULT_SETTINGS;
