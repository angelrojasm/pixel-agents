import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { HookEvent } from '../server/src/hookEventHandler.js';
import { HookEventHandler } from '../server/src/hookEventHandler.js';
import {
  installHooks,
  uninstallHooks,
} from '../server/src/providers/hook/claude/claudeHookInstaller.js';
import { claudeProvider, copyHookScript } from '../server/src/providers/index.js';
import { PixelAgentsServer } from '../server/src/server.js';
import {
  getProjectDirPath,
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restartPty,
  restoreAgents,
  sendCurrentAgentStatuses,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import type { LoadedAssets, LoadedCharacterSprites } from './assetLoader.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadExternalCharacterSprites,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeCharacterSprites,
  mergeLoadedAssets,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_HOOKS_INFO_SHOWN,
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_TERMINAL_FONT_FAMILY,
  GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
  GLOBAL_KEY_USE_PTY_TERMINAL,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
  LAYOUT_REVISION_KEY,
  TERMINAL_NAME_POLL_INTERVAL_MS,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import {
  adoptExternalSessionFromHook,
  dismissedJsonlFiles,
  ensureProjectScan,
  isTrackedProjectDir,
  reassignAgentToFile,
  scanForTeammateFiles,
  seededMtimes,
  setTeammateRemovalCallback,
  setTeamProvider,
  startExternalSessionScanning,
  startStaleExternalAgentCheck,
} from './fileWatcher.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import { webviewMessageSource } from './messageSource.js';
import { PtyManager } from './pty/ptyManager.js';
import { clearAwaitingUser } from './timerManager.js';
import { setHookProvider } from './transcriptParser.js';
import type { AgentState, MessageSink, MessageSource } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;
  /** Full-screen editor-tab panel, when open. Independent of the side-panel view. */
  fullScreenPanel: vscode.WebviewPanel | undefined;
  /** All currently-registered webviews (side panel + optional full-screen panel).
   *  Messages are fanned out to every entry; extension receives events from all. */
  private webviews = new Set<vscode.Webview>();

  /** Broadcast sink — post a message to every active webview.
   *  Downstream modules (agentManager, fileWatcher, etc.) take this instead of
   *  a single vscode.Webview so they stay webview-count-agnostic. */
  private broadcastSink: MessageSink = {
    postMessage: (message: unknown): Thenable<boolean> => {
      const promises: Thenable<boolean>[] = [];
      for (const w of this.webviews) promises.push(w.postMessage(message));
      // If there are no webviews, resolve true (no-op) so callers don't see undefined.
      if (promises.length === 0) return Promise.resolve(true);
      // Resolve when all have posted; true iff every individual post returned truthy.
      return Promise.all(promises).then((results) => results.every(Boolean));
    },
  };

  // Per-agent timers
  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // /clear detection: project-level scan for new JSONL files
  activeAgentId = { current: null as number | null };
  knownJsonlFiles = new Set<string>();
  projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

  // External session detection (VS Code extension panel, etc.)
  externalScanTimer: ReturnType<typeof setInterval> | null = null;
  staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Terminal name rename detection
  private terminalNamePollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSentTerminalNames = new Map<number, string>();

  // Global session scanning (opt-in "Watch All Sessions" toggle)
  watchAllSessions = { current: false };
  // Hooks enabled state (mutable ref for passing to scanners)
  hooksEnabled = { current: true };
  // Experimental: when true, spawn agents inside the office panel via pty/xterm
  // instead of vscode.window.createTerminal. Defaults to false (opt-in).
  usePtyTerminal = { current: false };
  globalDismissedFiles = new Set<string>();

  // Bundled default layout (loaded from assets/default-layout.json)
  defaultLayout: Record<string, unknown> | null = null;

  // Root path of bundled assets (set once on first load)
  private assetsRoot: string | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;

  // Pixel Agents Server (hook event reception)
  private pixelAgentsServer: PixelAgentsServer | null = null;
  // ServerConfig is not stored as a field; use this.pixelAgentsServer?.getConfig() if needed.
  private hookEventHandler: HookEventHandler | null = null;

  // Pty manager (lazy-init on first webview; shared across all webviews via attachSource)
  private ptyManager: PtyManager | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initHooks();
    this.registerTerminalListeners();
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private persistAgents = (): void => {
    persistAgents(this.agents, this.context);
  };

  private initHooks(): void {
    this.hookEventHandler = new HookEventHandler(
      this.agents,
      this.waitingTimers,
      this.permissionTimers,
      () => this.broadcastSink,
      claudeProvider,
      this.watchAllSessions,
    );

    // Register Claude's team provider (if present on the hook provider) with the file
    // watcher module + transcriptParser, plus the teammate removal callback.
    if (claudeProvider.team) {
      setTeamProvider(claudeProvider.team);
    }
    setHookProvider(claudeProvider);
    setTeammateRemovalCallback((id) => this.removeTeammate(id, 'team-config'));

    this.hookEventHandler.setLifecycleCallbacks({
      onExternalSessionDetected: (sessionId, transcriptPath, cwd) => {
        // Workspace filtering: only adopt if in a tracked project dir or Watch All Sessions is ON
        const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
        if (!isTrackedProjectDir(projectDir) && !this.watchAllSessions.current) {
          return; // Not our workspace and Watch All is OFF, ignore
        }
        adoptExternalSessionFromHook(
          sessionId,
          transcriptPath,
          cwd,
          this.knownJsonlFiles,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.broadcastSink,
          this.persistAgents,
          (agent) => this.registerAgentHook(agent),
        );
      },
      onSessionClear: (agentId, newSessionId, newTranscriptPath) => {
        if (newTranscriptPath) {
          this.knownJsonlFiles.add(newTranscriptPath);
          reassignAgentToFile(
            agentId,
            newTranscriptPath,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.broadcastSink,
            this.persistAgents,
          );
        }
        // Update session mapping for future hook events
        const agent = this.agents.get(agentId);
        if (agent) {
          this.unregisterAgentHook(agent);
          agent.sessionId = newSessionId;
          this.registerAgentHook(agent);
        }
      },
      onSessionResume: (transcriptPath) => {
        // Clear dismissals so --resume can re-adopt the file
        dismissedJsonlFiles.delete(transcriptPath);
        seededMtimes.delete(transcriptPath);
        this.knownJsonlFiles.delete(transcriptPath);
      },
      onTeammateDetected: (parentAgentId, sessionId, _agentType) => {
        const parentAgent = this.agents.get(parentAgentId);
        if (!parentAgent) return;
        scanForTeammateFiles(
          parentAgent.projectDir,
          sessionId,
          parentAgentId,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.broadcastSink,
          this.persistAgents,
          (agent) => this.registerAgentHook(agent),
        );
      },
      onTeammateRemoved: (teammateAgentId) => {
        this.removeTeammate(teammateAgentId, 'hooks');
      },
      onSessionEnd: (agentId) => {
        const agent = this.agents.get(agentId);
        if (!agent) return;
        // Dismiss the file so heuristic scanners don't re-adopt it
        seededMtimes.delete(agent.jsonlFile);
        dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
        // If this is a team lead, remove its teammates
        if (agent.isTeamLead) {
          this.removeTeammates(agentId);
        }
        // External agents: remove immediately (no terminal to keep alive)
        if (agent.isExternal) {
          this.unregisterAgentHook(agent);
          removeAgent(
            agentId,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          this.broadcastSink.postMessage({ type: 'agentClosed', id: agentId });
        }
      },
    });

    this.pixelAgentsServer = new PixelAgentsServer();
    this.pixelAgentsServer.onHookEvent((providerId, event) => {
      this.hookEventHandler?.handleEvent(providerId, event as HookEvent);
    });

    this.pixelAgentsServer
      .start()
      .then((config) => {
        // Server always starts regardless of hooks-enabled state.
        // It's the foundation for WebSocket transport and health monitoring.
        // Only hook installation/script-copy is gated by the toggle.
        const hooksEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED, true);
        this.hooksEnabled.current = hooksEnabled;
        if (hooksEnabled) {
          installHooks();
          copyHookScript(this.context.extensionPath);
        }
        console.log(`[Pixel Agents] Server: ready on port ${config.port}`);
      })
      .catch((e) => {
        console.error(`[Pixel Agents] Failed to start server: ${e}`);
      });
  }

  /** Remove all teammates of a lead agent */
  /** Remove a single teammate agent (used by both hook callback and team config polling). */
  private removeTeammate(teammateAgentId: number, source: string): void {
    const agent = this.agents.get(teammateAgentId);
    if (!agent) return;
    console.log(`[Pixel Agents] Removing teammate ${teammateAgentId} (source: ${source})`);
    dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
    this.unregisterAgentHook(agent);
    removeAgent(
      teammateAgentId,
      this.agents,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.jsonlPollTimers,
      this.persistAgents,
    );
    this.broadcastSink.postMessage({ type: 'agentClosed', id: teammateAgentId });
  }

  private removeTeammates(leadId: number): void {
    const teammates: number[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.leadAgentId === leadId) {
        teammates.push(id);
      }
    }
    for (const id of teammates) {
      const agent = this.agents.get(id);
      if (agent) {
        console.log(`[Pixel Agents] Removing teammate ${id} (lead ${leadId} closed)`);
        dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
        this.unregisterAgentHook(agent);
        removeAgent(
          id,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.persistAgents,
        );
        this.broadcastSink.postMessage({ type: 'agentClosed', id });
      }
    }
  }

  /** Register an agent with the hook event handler for session->agent mapping.
   *  hookDelivered is NOT set here. It is set only in hookEventHandler.handleEvent()
   *  when an actual hook event arrives, preserving heuristic fallback for agents
   *  where hooks aren't working (older Claude, hooks not installed, etc.) */
  registerAgentHook(agent: AgentState): void {
    this.hookEventHandler?.registerAgent(agent.sessionId, agent.id);
  }

  /** Unregister an agent from the hook event handler */
  unregisterAgentHook(agent: AgentState): void {
    this.hookEventHandler?.unregisterAgent(agent.sessionId);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    // Register this webview for broadcast fan-out.
    this.webviews.add(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.webviews.delete(webviewView.webview);
      if (this.webviewView === webviewView) this.webviewView = undefined;
    });

    // Inbound messages flow through the MessageSource abstraction so the Phase-3
    // WebSocket transport can swap in without touching the provider's dispatch logic.
    webviewMessageSource(webviewView.webview).onMessage((message) =>
      this.handleWebviewMessage(message),
    );
    this.ensurePtyManager(webviewMessageSource(webviewView.webview));
  }

  /**
   * Open (or focus) a full-screen Pixel Agents tab in the editor area.
   * Shares all extension state with the side-panel view; both webviews receive
   * broadcast messages and route their incoming messages to the same handler.
   */
  openFullScreenPanel(): void {
    if (this.fullScreenPanel) {
      try {
        this.fullScreenPanel.reveal();
        return;
      } catch {
        // Stale reference: VS Code disposed the panel but onDidDispose hadn't
        // cleaned up yet. Fall through to create a fresh panel.
        this.webviews.delete(this.fullScreenPanel.webview);
        this.fullScreenPanel = undefined;
      }
    }
    const panel = vscode.window.createWebviewPanel(
      'pixel-agents.fullScreen',
      'Pixel Agents',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = getWebviewContent(panel.webview, this.extensionUri);

    this.fullScreenPanel = panel;
    this.webviews.add(panel.webview);

    panel.onDidDispose(() => {
      this.webviews.delete(panel.webview);
      if (this.fullScreenPanel === panel) this.fullScreenPanel = undefined;
    });

    webviewMessageSource(panel.webview).onMessage((message) => this.handleWebviewMessage(message));
    this.ensurePtyManager(webviewMessageSource(panel.webview));
  }

  /** Dispatch an incoming message from any registered webview. */
  private async handleWebviewMessage(message: Record<string, unknown>): Promise<void> {
    if (message.type === 'openClaude') {
      const prevAgentIds = new Set(this.agents.keys());
      await launchNewTerminal(
        this.nextAgentId,
        this.nextTerminalIndex,
        this.agents,
        this.activeAgentId,
        this.knownJsonlFiles,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.projectScanTimer,
        this.broadcastSink,
        this.persistAgents,
        message.folderPath as string | undefined,
        message.bypassPermissions as boolean | undefined,
        this.context.globalState.get<string>(GLOBAL_KEY_DEFAULT_CWD, ''),
        this.usePtyTerminal.current,
        this.ptyManager,
      );
      // Register newly created agent(s) with hook handler
      for (const [id, agent] of this.agents) {
        if (!prevAgentIds.has(id)) {
          this.registerAgentHook(agent);
          if (agent.terminalRef?.name) {
            this.lastSentTerminalNames.set(id, agent.terminalRef.name);
          }
        }
      }
    } else if (message.type === 'focusAgent') {
      const agent = this.agents.get(message.id as number);
      if (agent) {
        if (agent.terminalRef) {
          agent.terminalRef.show();
        } else if (agent.leadAgentId !== undefined) {
          // Teammate (tmux): focus the lead's terminal instead
          const lead = this.agents.get(agent.leadAgentId);
          if (lead?.terminalRef) {
            lead.terminalRef.show();
          }
        }
      }
    } else if (message.type === 'dismissAwaitingUser') {
      // User acknowledged the "awaiting reply" state without actually replying.
      // Clear the persistent bubble and let the character resume normal idle behavior.
      const agentId = message.id as number;
      const agent = this.agents.get(agentId);
      clearAwaitingUser(agentId, agent);
      this.hookEventHandler?.clearAwaitingUser(agentId);
      this.broadcastSink.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'idle',
      });
    } else if (message.type === 'closeAgent') {
      const agent = this.agents.get(message.id as number);
      if (agent) {
        if (agent.ptyBacked) {
          // Pty-backed agent — kill the pty worker, then remove from tracking
          // and dismiss the JSONL file so scanners don't re-adopt it. No VS Code
          // terminal close event will fire, so cleanup is explicit here.
          this.ptyManager?.stop(agent.id);
          dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
          removeAgent(
            message.id as number,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          this.broadcastSink.postMessage({ type: 'agentClosed', id: message.id });
        } else if (agent.terminalRef) {
          agent.terminalRef.dispose();
        } else {
          // External agent — remove from tracking and dismiss the file
          // so the external scanner doesn't re-adopt it
          dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
          removeAgent(
            message.id as number,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          this.broadcastSink.postMessage({ type: 'agentClosed', id: message.id });
        }
      }
    } else if (message.type === 'saveAgentSeats') {
      // Store seat assignments in a separate key (never touched by persistAgents)
      console.log(`[Pixel Agents] State: saveAgentSeats:`, JSON.stringify(message.seats));
      this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
    } else if (message.type === 'saveLayout') {
      this.layoutWatcher?.markOwnWrite();
      writeLayoutToFile(message.layout as Record<string, unknown>);
    } else if (message.type === 'setSoundEnabled') {
      this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
    } else if (message.type === 'setLastSeenVersion') {
      this.context.globalState.update(GLOBAL_KEY_LAST_SEEN_VERSION, message.version as string);
    } else if (message.type === 'setAlwaysShowLabels') {
      this.context.globalState.update(GLOBAL_KEY_ALWAYS_SHOW_LABELS, message.enabled);
    } else if (message.type === 'setShowTerminalNames') {
      this.context.globalState.update(GLOBAL_KEY_SHOW_TERMINAL_NAMES, message.enabled);
    } else if (message.type === 'setDefaultCwd') {
      this.context.globalState.update(GLOBAL_KEY_DEFAULT_CWD, (message.value as string) ?? '');
    } else if (message.type === 'setHooksEnabled') {
      const enabled = message.enabled as boolean;
      this.context.globalState.update(GLOBAL_KEY_HOOKS_ENABLED, enabled);
      this.hooksEnabled.current = enabled;
      if (enabled) {
        installHooks();
        copyHookScript(this.context.extensionPath);
        console.log('[Pixel Agents] Hooks enabled by user');
      } else {
        uninstallHooks();
        console.log('[Pixel Agents] Hooks disabled by user');
      }
    } else if (message.type === 'setUsePtyTerminal') {
      const enabled = !!message.enabled;
      this.context.globalState.update(GLOBAL_KEY_USE_PTY_TERMINAL, enabled);
      this.usePtyTerminal.current = enabled;
    } else if (message.type === 'setTerminalFontFamily') {
      const value =
        typeof message.value === 'string'
          ? message.value
          : 'Menlo, Monaco, "Courier New", monospace';
      this.context.globalState.update(GLOBAL_KEY_TERMINAL_FONT_FAMILY, value);
    } else if (message.type === 'setTerminalLineHeight') {
      const value =
        typeof message.value === 'number' && Number.isFinite(message.value) ? message.value : 1.0;
      this.context.globalState.update(GLOBAL_KEY_TERMINAL_LINE_HEIGHT, value);
    } else if (message.type === 'setHooksInfoShown') {
      this.context.globalState.update(GLOBAL_KEY_HOOKS_INFO_SHOWN, true);
    } else if (message.type === 'setWatchAllSessions') {
      const enabled = message.enabled as boolean;
      this.context.globalState.update(GLOBAL_KEY_WATCH_ALL_SESSIONS, enabled);
      this.watchAllSessions.current = enabled;
      if (enabled) {
        // Clear only toggle-specific dismissals so global agents can be re-adopted
        for (const file of this.globalDismissedFiles) {
          dismissedJsonlFiles.delete(file);
        }
        this.globalDismissedFiles.clear();
      } else {
        // Remove all external agents not from the current workspace folders
        const workspaceDirs = new Set<string>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          const dir = getProjectDirPath(folder.uri.fsPath);
          if (dir) workspaceDirs.add(dir);
        }
        const toRemove: number[] = [];
        for (const [id, agent] of this.agents) {
          if (agent.isExternal && !workspaceDirs.has(agent.projectDir)) {
            toRemove.push(id);
          }
        }
        for (const id of toRemove) {
          const agent = this.agents.get(id);
          if (agent) {
            dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
            this.globalDismissedFiles.add(agent.jsonlFile);
            this.knownJsonlFiles.delete(agent.jsonlFile);
          }
          removeAgent(
            id,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          this.broadcastSink.postMessage({ type: 'agentClosed', id });
        }
      }
    } else if (message.type === 'webviewReady') {
      // Note: pty-backed agents are runtime-only in v1 — they're filtered out of
      // persistAgents() so restoreAgents never sees them. On reload, the user must
      // re-spawn them with + Agent. Future: re-attach via `claude --resume <id>`.
      restoreAgents(
        this.context,
        this.nextAgentId,
        this.nextTerminalIndex,
        this.agents,
        this.knownJsonlFiles,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.projectScanTimer,
        this.activeAgentId,
        this.broadcastSink,
        this.persistAgents,
      );
      // Ghost-session cleanup: if Watch All Sessions is off, prune any persisted
      // external agents whose projectDir isn't in the current workspace. These
      // are leftovers from prior sessions (or earlier Watch-All windows) and
      // would otherwise appear as ghosts until the user toggles Watch-All.
      this.pruneForeignExternalsIfWatchAllOff();
      // Register all remaining restored agents with the hook handler
      for (const agent of this.agents.values()) {
        this.registerAgentHook(agent);
      }
      // Send persisted settings to webview
      const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
      const lastSeenVersion = this.context.globalState.get<string>(
        GLOBAL_KEY_LAST_SEEN_VERSION,
        '',
      );
      const extensionVersion =
        (this.context.extension.packageJSON as { version?: string }).version ?? '';
      const watchAllSessions = this.context.globalState.get<boolean>(
        GLOBAL_KEY_WATCH_ALL_SESSIONS,
        false,
      );
      const alwaysShowLabels = this.context.globalState.get<boolean>(
        GLOBAL_KEY_ALWAYS_SHOW_LABELS,
        false,
      );
      const showTerminalNames = this.context.globalState.get<boolean>(
        GLOBAL_KEY_SHOW_TERMINAL_NAMES,
        true,
      );
      this.watchAllSessions.current = watchAllSessions;
      const hooksEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED, true);
      const hooksInfoShown = this.context.globalState.get<boolean>(
        GLOBAL_KEY_HOOKS_INFO_SHOWN,
        false,
      );
      const defaultCwd = this.context.globalState.get<string>(GLOBAL_KEY_DEFAULT_CWD, '');
      this.usePtyTerminal.current = this.context.globalState.get<boolean>(
        GLOBAL_KEY_USE_PTY_TERMINAL,
        false,
      );
      const config = readConfig();
      this.broadcastSink.postMessage({
        type: 'settingsLoaded',
        soundEnabled,
        lastSeenVersion,
        extensionVersion,
        watchAllSessions,
        alwaysShowLabels,
        showTerminalNames,
        hooksEnabled,
        hooksInfoShown,
        defaultCwd,
        externalAssetDirectories: config.externalAssetDirectories,
        usePtyTerminal: this.usePtyTerminal.current,
        terminalFontFamily: this.context.globalState.get<string>(
          GLOBAL_KEY_TERMINAL_FONT_FAMILY,
          'Menlo, Monaco, "Courier New", monospace',
        ),
        terminalLineHeight: this.context.globalState.get<number>(
          GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
          1.0,
        ),
      });

      // Send workspace folders to webview (only when multi-root)
      const wsFolders = vscode.workspace.workspaceFolders;
      if (wsFolders && wsFolders.length > 1) {
        this.broadcastSink.postMessage({
          type: 'workspaceFolders',
          folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
        });
      }

      // Ensure project scan runs even with no restored agents (to adopt external terminals)
      const projectDir = getProjectDirPath();
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      console.log(`[Pixel Agents] Debug: Platform: ${process.platform}, arch: ${process.arch}`);
      console.log('[Extension] workspaceRoot:', workspaceRoot);
      console.log('[Extension] projectDir:', projectDir);
      ensureProjectScan(
        projectDir,
        this.knownJsonlFiles,
        this.projectScanTimer,
        this.activeAgentId,
        this.nextAgentId,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.broadcastSink,
        this.persistAgents,
        (agent) => this.registerAgentHook(agent),
        this.hooksEnabled,
      );

      // Start external session scanning (detects VS Code extension panel sessions)
      if (!this.externalScanTimer) {
        this.externalScanTimer = startExternalSessionScanning(
          projectDir,
          this.knownJsonlFiles,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.broadcastSink,
          this.persistAgents,
          this.watchAllSessions,
          this.hooksEnabled,
        );

        // In multi-root workspaces, also scan project dirs for all other folders
        // so agents running in any workspace folder are discovered
        if (wsFolders && wsFolders.length > 1) {
          for (const folder of wsFolders) {
            const folderProjectDir = getProjectDirPath(folder.uri.fsPath);
            if (folderProjectDir && folderProjectDir !== projectDir) {
              console.log(`[Pixel Agents] Registering additional project dir: ${folderProjectDir}`);
              ensureProjectScan(
                folderProjectDir,
                this.knownJsonlFiles,
                this.projectScanTimer,
                this.activeAgentId,
                this.nextAgentId,
                this.agents,
                this.fileWatchers,
                this.pollingTimers,
                this.waitingTimers,
                this.permissionTimers,
                this.broadcastSink,
                this.persistAgents,
                undefined,
                this.hooksEnabled,
              );
            }
          }
        }
      }
      if (!this.staleCheckTimer) {
        this.staleCheckTimer = startStaleExternalAgentCheck(
          this.agents,
          this.knownJsonlFiles,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.broadcastSink,
          this.persistAgents,
          this.hooksEnabled,
        );
      }

      // Load furniture assets BEFORE sending layout
      (async () => {
        try {
          console.log('[Extension] Loading furniture assets...');
          const extensionPath = this.extensionUri.fsPath;
          console.log('[Extension] extensionPath:', extensionPath);

          // Check bundled location first: extensionPath/dist/assets/
          const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
          let assetsRoot: string | null = null;
          if (fs.existsSync(bundledAssetsDir)) {
            console.log('[Extension] Found bundled assets at dist/');
            assetsRoot = path.join(extensionPath, 'dist');
          } else if (workspaceRoot) {
            // Fall back to workspace root (development or external assets)
            console.log('[Extension] Trying workspace for assets...');
            assetsRoot = workspaceRoot;
          }

          if (!assetsRoot) {
            console.log('[Extension] ⚠️  No assets directory found');
            if (this.webviews.size > 0) {
              sendLayout(this.context, this.broadcastSink, this.defaultLayout);
              // Send agent statuses AFTER layoutLoaded so characters exist when messages arrive
              sendCurrentAgentStatuses(this.agents, this.broadcastSink);
              this.startLayoutWatcher();
            }
            return;
          }

          console.log('[Extension] Using assetsRoot:', assetsRoot);
          this.assetsRoot = assetsRoot;

          // Load bundled default layout
          this.defaultLayout = loadDefaultLayout(assetsRoot);

          // Load character sprites (bundled + external)
          const charSprites = await this.loadAllCharacterSprites();
          if (charSprites && this.webviews.size > 0) {
            console.log(
              `[Extension] ${charSprites.characters.length} character sprites loaded, sending to webview`,
            );
            sendCharacterSpritesToWebview(this.broadcastSink, charSprites);
          }

          // Load floor tiles
          const floorTiles = await loadFloorTiles(assetsRoot);
          if (floorTiles && this.webviews.size > 0) {
            console.log('[Extension] Floor tiles loaded, sending to webview');
            sendFloorTilesToWebview(this.broadcastSink, floorTiles);
          }

          // Load wall tiles
          const wallTiles = await loadWallTiles(assetsRoot);
          if (wallTiles && this.webviews.size > 0) {
            console.log('[Extension] Wall tiles loaded, sending to webview');
            sendWallTilesToWebview(this.broadcastSink, wallTiles);
          }

          const assets = await this.loadAllFurnitureAssets();
          if (assets && this.webviews.size > 0) {
            console.log('[Extension] ✅ Assets loaded, sending to webview');
            sendAssetsToWebview(this.broadcastSink, assets);
          }
        } catch (err) {
          console.error('[Extension] ❌ Error loading assets:', err);
        }
        // Always send saved layout (or null for default)
        if (this.webviews.size > 0) {
          console.log('[Extension] Sending saved layout');
          sendLayout(this.context, this.broadcastSink, this.defaultLayout);
          // Send agent statuses AFTER layoutLoaded so characters exist when messages arrive
          sendCurrentAgentStatuses(this.agents, this.broadcastSink);
          this.startLayoutWatcher();
        }
      })();
      sendExistingAgents(this.agents, this.context, this.broadcastSink);
      // Seed last-sent snapshot so we only push real changes
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef?.name) {
          this.lastSentTerminalNames.set(id, agent.terminalRef.name);
        }
      }
      if (!this.terminalNamePollTimer) {
        this.terminalNamePollTimer = setInterval(() => {
          for (const [id, agent] of this.agents) {
            const current = agent.terminalRef?.name;
            if (!current) continue;
            const previous = this.lastSentTerminalNames.get(id);
            if (previous !== current) {
              this.lastSentTerminalNames.set(id, current);
              this.broadcastSink.postMessage({
                type: 'agentTerminalNameChanged',
                id,
                terminalName: current,
              });
            }
          }
        }, TERMINAL_NAME_POLL_INTERVAL_MS);
      }
    } else if (message.type === 'requestDiagnostics') {
      // Send connection diagnostics for all agents to the Debug View
      const diagnostics: Array<Record<string, unknown>> = [];
      for (const [, agent] of this.agents) {
        let jsonlExists = false;
        let fileSize = 0;
        try {
          const stat = fs.statSync(agent.jsonlFile);
          jsonlExists = true;
          fileSize = stat.size;
        } catch {
          /* file doesn't exist */
        }
        diagnostics.push({
          id: agent.id,
          projectDir: agent.projectDir,
          projectDirExists: fs.existsSync(agent.projectDir),
          jsonlFile: agent.jsonlFile,
          jsonlExists,
          fileSize,
          fileOffset: agent.fileOffset,
          lastDataAt: agent.lastDataAt,
          linesProcessed: agent.linesProcessed,
        });
      }
      this.broadcastSink.postMessage({ type: 'agentDiagnostics', agents: diagnostics });
    } else if (message.type === 'openSessionsFolder') {
      const projectDir = getProjectDirPath();
      if (projectDir && fs.existsSync(projectDir)) {
        vscode.env.openExternal(vscode.Uri.file(projectDir));
      }
    } else if (message.type === 'exportLayout') {
      const layout = readLayoutFromFile();
      if (!layout) {
        vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON Files': ['json'] },
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
        vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
      }
    } else if (message.type === 'addExternalAssetDirectory') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Asset Directory',
      });
      if (!uris || uris.length === 0) return;
      const newPath = uris[0].fsPath;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      await this.reloadAndSendCharacters();
      await this.reloadAndSendFurniture();
      this.broadcastSink.postMessage({
        type: 'externalAssetDirectoriesUpdated',
        dirs: cfg.externalAssetDirectories,
      });
    } else if (message.type === 'removeExternalAssetDirectory') {
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter(
        (d) => d !== (message.path as string),
      );
      writeConfig(cfg);
      await this.reloadAndSendCharacters();
      await this.reloadAndSendFurniture();
      this.broadcastSink.postMessage({
        type: 'externalAssetDirectoriesUpdated',
        dirs: cfg.externalAssetDirectories,
      });
    } else if (message.type === 'importLayout') {
      const uris = await vscode.window.showOpenDialog({
        filters: { 'JSON Files': ['json'] },
        canSelectMany: false,
      });
      if (!uris || uris.length === 0) return;
      try {
        const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
        const imported = JSON.parse(raw) as Record<string, unknown>;
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
          return;
        }
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(imported);
        this.broadcastSink.postMessage({ type: 'layoutLoaded', layout: imported });
        vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
      } catch {
        vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
      }
    } else if (message.type === 'openExternal') {
      const uri = typeof message.uri === 'string' ? message.uri : '';
      if (uri) {
        try {
          vscode.env.openExternal(vscode.Uri.parse(uri));
        } catch (err) {
          console.warn('[Pixel Agents] openExternal: invalid URI', uri, err);
        }
      }
    } else if (message.type === 'acknowledgeCrash') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId === null) return;
      this.broadcastSink.postMessage({ type: 'crashAcknowledged', agentId });
    } else if (message.type === 'restartAgent') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId === null) return;
      const bypass = !!this.context.workspaceState.get<boolean>(
        'pixel-agents.bypassPermissions',
        false,
      );
      const defaultCwd = this.context.globalState.get<string>(GLOBAL_KEY_DEFAULT_CWD, '');
      const ok = restartPty(agentId, this.agents, this.ptyManager, defaultCwd, bypass);
      if (ok) {
        this.broadcastSink.postMessage({ type: 'agentRestarted', agentId });
      }
    }
  }

  /** Remove persisted external agents whose projectDir isn't in the current workspace,
   *  unless Watch All Sessions is on. Runs once at startup after restoreAgents. Same
   *  rule used by the Watch-All toggle-off handler — ensures a consistent ruleset
   *  whether you disable Watch-All explicitly or have it off from the start. */
  private pruneForeignExternalsIfWatchAllOff(): void {
    const enabled = this.context.globalState.get<boolean>(GLOBAL_KEY_WATCH_ALL_SESSIONS, false);
    if (enabled) return;

    const workspaceDirs = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const dir = getProjectDirPath(folder.uri.fsPath);
      if (dir) workspaceDirs.add(dir);
    }

    const toRemove: number[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.isExternal && !workspaceDirs.has(agent.projectDir)) {
        toRemove.push(id);
      }
    }
    if (toRemove.length === 0) return;

    console.log(
      `[Pixel Agents] Startup: pruning ${toRemove.length} foreign external agent(s) (Watch-All off)`,
    );
    for (const id of toRemove) {
      const agent = this.agents.get(id);
      if (agent) {
        dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
        this.globalDismissedFiles.add(agent.jsonlFile);
        this.knownJsonlFiles.delete(agent.jsonlFile);
      }
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistAgents,
      );
      this.broadcastSink.postMessage({ type: 'agentClosed', id });
    }
  }

  /** Register VS Code window-level listeners (terminal focus + close).
   *  Called once during construction; unrelated to webview lifecycle. */
  private registerTerminalListeners(): void {
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      this.activeAgentId.current = null;
      if (!terminal) return;
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef && agent.terminalRef === terminal) {
          this.activeAgentId.current = id;
          this.broadcastSink.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef && agent.terminalRef === closed) {
          if (this.activeAgentId.current === id) {
            this.activeAgentId.current = null;
          }
          if (agent.isTeamLead) {
            this.removeTeammates(id);
          }
          dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
          this.unregisterAgentHook(agent);
          removeAgent(
            id,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          this.broadcastSink.postMessage({ type: 'agentClosed', id });
        }
      }
    });
  }

  /** Export current saved layout as a versioned default-layout-{N}.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }
    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');

    // Find the next revision number
    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
        }
      }
    }
    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(
      `Pixel Agents: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  private async loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!this.assetsRoot) return null;
    let assets = await loadFurnitureAssets(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external assets from:', extraDir);
      const extra = await loadFurnitureAssets(extraDir);
      if (extra) {
        assets = assets ? mergeLoadedAssets(assets, extra) : extra;
      }
    }
    return assets;
  }

  private async loadAllCharacterSprites(): Promise<LoadedCharacterSprites | null> {
    if (!this.assetsRoot) return null;
    let chars = await loadCharacterSprites(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external character sprites from:', extraDir);
      const extra = await loadExternalCharacterSprites(extraDir);
      if (extra) {
        chars = chars ? mergeCharacterSprites(chars, extra) : extra;
      }
    }
    return chars;
  }

  private async reloadAndSendFurniture(): Promise<void> {
    if (!this.assetsRoot || this.webviews.size === 0) return;
    try {
      const assets = await this.loadAllFurnitureAssets();
      if (assets) {
        sendAssetsToWebview(this.broadcastSink, assets);
      }
    } catch (err) {
      console.error('[Extension] Error reloading furniture assets:', err);
    }
  }

  private async reloadAndSendCharacters(): Promise<void> {
    if (!this.assetsRoot || this.webviews.size === 0) return;
    try {
      const chars = await this.loadAllCharacterSprites();
      if (chars) {
        sendCharacterSpritesToWebview(this.broadcastSink, chars);
      }
    } catch (err) {
      console.error('[Extension] Error reloading character sprites:', err);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change — pushing to webview');
      this.broadcastSink.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  /** Lazy-init the PtyManager on the first webview, then attach additional
   *  webview sources to the same manager so pty messages route from any
   *  open webview into the workers. */
  private ensurePtyManager(source: MessageSource): void {
    if (this.ptyManager === null) {
      this.ptyManager = new PtyManager({
        sink: this.broadcastSink,
        source,
      });
    } else {
      this.ptyManager.attachSource(source);
    }
  }

  dispose() {
    if (this.terminalNamePollTimer) {
      clearInterval(this.terminalNamePollTimer);
      this.terminalNamePollTimer = null;
    }
    this.lastSentTerminalNames.clear();
    this.pixelAgentsServer?.stop();
    this.pixelAgentsServer = null;
    this.hookEventHandler?.dispose();
    this.hookEventHandler = null;
    this.ptyManager?.disposeAll();
    this.ptyManager = null;
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistAgents,
      );
    }
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
    if (this.externalScanTimer) {
      clearInterval(this.externalScanTimer);
      this.externalScanTimer = null;
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
  }
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
