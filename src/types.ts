import type { Disposable } from './disposable.js';
import type { HostTerminal } from './hostBridge.js';

/**
 * Narrow abstraction over `vscode.Webview` for modules that only need to post
 * messages. In single-webview setups this is just the one webview; in
 * multi-webview setups (side panel + full-screen tab) it's a broadcast sink
 * implemented by PixelAgentsViewProvider.
 *
 * The downstream modules (agentManager, fileWatcher, transcriptParser,
 * assetLoader, timerManager, hookEventHandler) never touch `asWebviewUri`,
 * `options`, or `onDidReceiveMessage` — they only post. So we pass this
 * instead of the full `vscode.Webview`.
 */
export interface MessageSink {
  postMessage(message: unknown): Thenable<boolean>;
}

/**
 * Inbound counterpart to MessageSink. Abstracts the path that delivers messages
 * FROM a webview (or a future WebSocket transport) into the extension. Matches
 * the shape used by `vscode.Webview.onDidReceiveMessage` so wiring stays small.
 *
 * Today's implementation wraps `vscode.Webview` (see `webviewMessageSource`).
 * Phase 3 will swap in a WebSocket-backed source for the same handler.
 *
 * The interface returns `Disposable` rather than `vscode.Disposable` so
 * daemon-only modules don't incidentally import vscode. Structurally compatible.
 */
export interface MessageSource {
  onMessage(handler: (message: Record<string, unknown>) => unknown): Disposable;
}

export interface AgentState {
  id: number;
  sessionId: string;
  /**
   * Terminal reference — undefined for extension panel sessions, and always
   * undefined in daemon mode (the daemon owns ptys, not host terminals).
   * Typed as `HostTerminal` rather than `vscode.Terminal` so this file — and
   * everything importing it — stays loadable outside the extension host.
   */
  terminalRef?: HostTerminal;
  /** Display name for pty-backed agents (no terminalRef to read it from);
   *  e.g. "Claude Code #1". Used by snapshot replay and persistence. */
  terminalName?: string;
  /** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Timestamp (ms since epoch) when the agent escalated to the persistent awaiting-user
   *  state (after AWAITING_USER_GRACE_MS past turn end with no user prompt or tool use).
   *  null while in the grace window or during active/normal-idle. Cleared on active
   *  transitions and user dismissal. */
  awaitingSince: number | null;
  /** When true, this agent's terminal is backed by a node-pty worker (see PtyManager)
   *  and routes I/O through the webview xterm.js pane. Always true for new agents
   *  (pty is the only terminal backend). */
  ptyBacked?: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers) */
  hookDelivered: boolean;
  /** True when agent has no transcript file (provider doesn't use JSONL). All state from hooks. */
  hooksOnly?: boolean;
  /** Provider that created this agent (defaults to 'claude') */
  providerId?: string;
  /** Set when SessionEnd(reason=clear) fires; cleared when SessionStart(source=clear) reassigns */
  pendingClear?: boolean;
  /** Hook-generated tool ID for PreToolUse/PostToolUse correlation */
  currentHookToolId?: string;
  /** Tool name from PreToolUse (e.g. 'Agent', 'Task') for SubagentStart correlation */
  currentHookToolName?: string;
  /** True if the CURRENT PreToolUse tool call is a teammate spawn (e.g. Agent with
   *  run_in_background=true). Authoritative source for teammate vs basic-subagent
   *  routing in SubagentStart. Set in PreToolUse, NOT cleared in PostToolUse (survives
   *  the PostToolUse-before-SubagentStart race); overwritten on the next PreToolUse. */
  currentHookIsTeammateSpawn?: boolean;

  // -- Token tracking --
  inputTokens: number;
  outputTokens: number;

  // -- Visual state (palette/seat) — source of truth for agents.json persistence --
  /** Sprite palette index (0–5) */
  palette: number;
  /** Hue shift in degrees (0 = no shift) */
  hueShift: number;
  /** Work seat UID assigned to this agent (undefined = no seat assigned) */
  workSeatId?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  /** Display name set by Claude's /rename command (read from JSONL custom-title record).
   *  Takes precedence over agentName and terminalName in the UI. */
  customTitle?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** True when lead spawns teammates via tmux (run_in_background Agent calls) */
  teamUsesTmux?: boolean;
}

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  /** Terminal name — empty string for extension panel sessions */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;

  // -- Visual state --
  palette: number;
  hueShift: number;
  workSeatId?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  customTitle?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}
