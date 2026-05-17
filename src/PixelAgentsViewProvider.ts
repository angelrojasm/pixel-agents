import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentsFile } from '../daemon/agentsPersistence.js';
import { readAgents, writeAgents } from '../daemon/agentsPersistence.js';
import type { ConfigStore } from '../daemon/configStore.js';
import { createConfigStore } from '../daemon/configStore.js';
import type { Orchestrator } from '../daemon/orchestrator.js';
import { createOrchestrator } from '../daemon/orchestrator.js';
import {
  installHooks,
  uninstallHooks,
} from '../server/src/providers/hook/claude/claudeHookInstaller.js';
import { copyHookScript } from '../server/src/providers/index.js';
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
import { readConfig, writeConfig } from './configPersistence.js';
import type { SettingsCategory } from './constants.js';
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
  LAYOUT_REVISION_KEY,
  TERMINAL_NAME_POLL_INTERVAL_MS,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import {
  dismissedJsonlFiles,
  ensureProjectScan,
  startExternalSessionScanning,
  startStaleExternalAgentCheck,
} from './fileWatcher.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import { webviewMessageSource } from './messageSource.js';
import type { AgentState, MessageSink, MessageSource } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  webviewView: vscode.WebviewView | undefined;
  /** Full-screen editor-tab panel, when open. Independent of the side-panel view. */
  fullScreenPanel: vscode.WebviewPanel | undefined;
  /** All currently-registered webviews (side panel + optional full-screen panel).
   *  Messages are fanned out to every entry; extension receives events from all. */
  private webviews = new Set<vscode.Webview>();

  /** Broadcast sink — post a message to every active webview. */
  private broadcastSink: MessageSink = {
    postMessage: (message: unknown): Thenable<boolean> => {
      const promises: Thenable<boolean>[] = [];
      for (const w of this.webviews) promises.push(w.postMessage(message));
      if (promises.length === 0) return Promise.resolve(true);
      return Promise.all(promises).then((results) => results.every(Boolean));
    },
  };

  // Terminal name rename detection
  private terminalNamePollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSentTerminalNames = new Map<number, string>();

  // Pixel Agents Server
  private pixelAgentsServer: PixelAgentsServer;

  /** File-backed settings store. */
  private readonly config: ConfigStore;

  /** Orchestrator — owns all host-agnostic state + wiring. */
  private readonly orchestrator: Orchestrator;

  /** Whether orchestrator.start() has been called (triggered by first webviewReady). */
  private orchestratorStarted = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.config = createConfigStore(path.join(os.homedir(), '.pixel-agents', 'config.json'));

    this.pixelAgentsServer = new PixelAgentsServer();

    // Resolve assetsRoot from extensionUri (available synchronously in constructor)
    const extensionPath = this.context.extensionUri.fsPath;
    const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let assetsRoot: string | null = null;
    if (fs.existsSync(bundledAssetsDir)) {
      assetsRoot = path.join(extensionPath, 'dist');
    } else if (workspaceRoot) {
      assetsRoot = workspaceRoot;
    }

    const extensionVersion =
      (this.context.extension.packageJSON as { version?: string }).version ?? '';

    this.orchestrator = createOrchestrator({
      broadcastSink: this.broadcastSink,
      server: this.pixelAgentsServer,
      config: this.config,
      agentsFilePath: this.agentsFilePath,
      assetsRoot,
      extensionVersion,
    });

    this.pixelAgentsServer
      .start()
      .then((cfg) => {
        const hooksEnabled =
          this.config.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED) ??
          DEFAULT_SETTINGS.agents.hooksEnabled;
        this.orchestrator.hooksEnabled.current = hooksEnabled;
        if (hooksEnabled) {
          installHooks();
          copyHookScript(this.context.extensionPath);
        }
        console.log(`[Pixel Agents] Server: ready on port ${cfg.port}`);
      })
      .catch((e) => {
        console.error(`[Pixel Agents] Failed to start server: ${e}`);
      });

    this.registerTerminalListeners();
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /** Path to the user-level agents.json file. */
  private readonly agentsFilePath = path.join(os.homedir(), '.pixel-agents', 'agents.json');

  /** Accessor for the live agent map (cast from ReadonlyMap). */
  private get agents() {
    return this.orchestrator.agents as Map<number, AgentState>;
  }

  private persistAgentsFn = (): void => {
    persistAgents(
      this.agents,
      this.agentsFilePath,
      this.orchestrator.nextAgentId,
      this.orchestrator.nextTerminalIndex,
    );
  };

  /**
   * One-time migration: if agents.json doesn't exist yet but workspaceState has
   * persisted agents, merge both into the unified file format.
   */
  private migrateAgentsFromWorkspaceState(): void {
    if (fs.existsSync(this.agentsFilePath)) return;

    type LegacyAgent = {
      id: number;
      sessionId?: string;
      terminalName: string;
      isExternal?: boolean;
      jsonlFile: string;
      projectDir: string;
      folderName?: string;
      teamName?: string;
      agentName?: string;
      customTitle?: string;
      isTeamLead?: boolean;
      leadAgentId?: number;
      teamUsesTmux?: boolean;
    };
    type SeatEntry = {
      workSeatId?: string;
      seatId?: string;
      palette?: number;
      hueShift?: number;
    };

    const legacyAgents = this.context.workspaceState.get<LegacyAgent[]>(WORKSPACE_KEY_AGENTS, []);
    if (legacyAgents.length === 0) return;

    const rawSeats = this.context.workspaceState.get<Record<string, SeatEntry>>(
      WORKSPACE_KEY_AGENT_SEATS,
      {},
    );

    const merged: AgentsFile['agents'] = legacyAgents.map((a) => {
      const seat = rawSeats[String(a.id)] ?? {};
      return {
        id: a.id,
        sessionId: a.sessionId,
        terminalName: a.terminalName,
        isExternal: a.isExternal,
        jsonlFile: a.jsonlFile,
        projectDir: a.projectDir,
        palette: seat.palette ?? 0,
        hueShift: seat.hueShift ?? 0,
        workSeatId: seat.workSeatId ?? seat.seatId,
        teamName: a.teamName,
        agentName: a.agentName,
        customTitle: a.customTitle,
        isTeamLead: a.isTeamLead,
        leadAgentId: a.leadAgentId,
        teamUsesTmux: a.teamUsesTmux,
      };
    });

    let maxId = 0;
    let maxIdx = 0;
    for (const a of legacyAgents) {
      if (a.id > maxId) maxId = a.id;
      const m = a.terminalName.match(/#(\d+)$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (idx > maxIdx) maxIdx = idx;
      }
    }

    const dir = path.dirname(this.agentsFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    writeAgents(this.agentsFilePath, {
      version: 1,
      nextAgentId: maxId + 1,
      nextTerminalIndex: maxIdx + 1,
      agents: merged,
    });

    console.log(
      `[Pixel Agents] Migrated ${merged.length} agent(s) from workspaceState → ${this.agentsFilePath}`,
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    this.webviews.add(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.webviews.delete(webviewView.webview);
      if (this.webviewView === webviewView) this.webviewView = undefined;
    });

    webviewMessageSource(webviewView.webview).onMessage((message) =>
      this.handleWebviewMessage(message, webviewView.webview),
    );
    this.ensurePtyManager(webviewMessageSource(webviewView.webview));
  }

  /**
   * Open (or focus) a full-screen Pixel Agents tab in the editor area.
   */
  openFullScreenPanel(): void {
    if (this.fullScreenPanel) {
      try {
        this.fullScreenPanel.reveal();
        return;
      } catch {
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

    webviewMessageSource(panel.webview).onMessage((message) =>
      this.handleWebviewMessage(message, panel.webview),
    );
    this.ensurePtyManager(webviewMessageSource(panel.webview));
  }

  /** Dispatch an incoming message from any registered webview. */
  private async handleWebviewMessage(
    message: Record<string, unknown>,
    originWebview?: vscode.Webview,
  ): Promise<void> {
    const o = this.orchestrator;

    if (message.type === 'openClaude') {
      const prevAgentIds = new Set(this.agents.keys());
      await launchNewTerminal(
        o.nextAgentId,
        o.nextTerminalIndex,
        this.agents,
        o.activeAgentId,
        o.knownJsonlFiles,
        o.fileWatchers,
        o.pollingTimers,
        o.waitingTimers,
        o.permissionTimers,
        o.jsonlPollTimers,
        o.projectScanTimer,
        this.broadcastSink,
        this.persistAgentsFn,
        message.folderPath as string | undefined,
        message.bypassPermissions as boolean | undefined,
        this.config.get<string>(GLOBAL_KEY_DEFAULT_CWD) ?? DEFAULT_SETTINGS.agents.defaultCwd,
        o.ptyManager,
      );
      for (const [id, agent] of this.agents) {
        if (!prevAgentIds.has(id)) {
          o.registerAgentHook(agent);
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
          const lead = this.agents.get(agent.leadAgentId);
          if (lead?.terminalRef) {
            lead.terminalRef.show();
          }
        }
      }
    } else if (message.type === 'dismissAwaitingUser') {
      o.dismissAwaitingUser(message.id as number);
    } else if (message.type === 'closeAgent') {
      const agent = this.agents.get(message.id as number);
      if (agent) {
        if (agent.ptyBacked) {
          o.closeExternalOrPtyAgent(message.id as number);
        } else if (agent.terminalRef) {
          agent.terminalRef.dispose();
        } else {
          // External (no terminal, not pty)
          o.closeExternalOrPtyAgent(message.id as number);
        }
      }
    } else if (message.type === 'saveAgentSeats') {
      const seats = message.seats as Record<
        number,
        { palette: number; hueShift: number; workSeatId: string | null }
      >;
      console.log(`[Pixel Agents] State: saveAgentSeats:`, JSON.stringify(seats));
      o.saveAgentSeats(seats);
    } else if (message.type === 'saveLayout') {
      o.markLayoutWrite();
      writeLayoutToFile(message.layout as Record<string, unknown>);
    } else if (message.type === 'setHooksEnabled') {
      const enabled = message.enabled as boolean;
      this.config.update(GLOBAL_KEY_HOOKS_ENABLED, enabled);
      o.hooksEnabled.current = enabled;
      if (enabled) {
        installHooks();
        copyHookScript(this.context.extensionPath);
        console.log('[Pixel Agents] Hooks enabled by user');
      } else {
        uninstallHooks();
        console.log('[Pixel Agents] Hooks disabled by user');
      }
    } else if (message.type === 'setWatchAllSessions') {
      this.handleSetWatchAllSessions(message.enabled as boolean);
    } else if (message.type === 'restoreCategoryDefaults') {
      const category = message.category as SettingsCategory;
      o.restoreCategoryDefaults(
        category,
        message.values as Partial<(typeof DEFAULT_SETTINGS)[typeof category]> | undefined,
      );
      o.broadcastSettingsLoaded();
    } else if (message.type === 'webviewReady') {
      // One-time migration: copy workspaceState data into agents.json if needed.
      this.migrateAgentsFromWorkspaceState();

      if (!this.orchestratorStarted) {
        this.orchestratorStarted = true;

        // Extension-specific: restore agents using VS Code terminal matching
        restoreAgents(
          () => readAgents(this.agentsFilePath),
          o.nextAgentId,
          o.nextTerminalIndex,
          this.agents,
          o.knownJsonlFiles,
          o.fileWatchers,
          o.pollingTimers,
          o.waitingTimers,
          o.permissionTimers,
          o.jsonlPollTimers,
          o.projectScanTimer,
          o.activeAgentId,
          this.broadcastSink,
          this.persistAgentsFn,
        );

        // Ghost-session cleanup
        this.pruneForeignExternalsIfWatchAllOff();

        // Register restored agents with hook handler
        for (const agent of this.agents.values()) {
          o.registerAgentHook(agent);
        }

        // Sync mutable refs before broadcasting
        o.watchAllSessions.current =
          this.config.get<boolean>(GLOBAL_KEY_WATCH_ALL_SESSIONS) ??
          DEFAULT_SETTINGS.agents.watchAllSessions;

        // Start VS Code-specific project + external scanners
        const projectDir = getProjectDirPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;
        console.log(`[Pixel Agents] Debug: Platform: ${process.platform}, arch: ${process.arch}`);
        console.log('[Extension] workspaceRoot:', workspaceRoot);
        console.log('[Extension] projectDir:', projectDir);

        ensureProjectScan(
          projectDir,
          o.knownJsonlFiles,
          o.projectScanTimer,
          o.activeAgentId,
          o.nextAgentId,
          this.agents,
          o.fileWatchers,
          o.pollingTimers,
          o.waitingTimers,
          o.permissionTimers,
          this.broadcastSink,
          this.persistAgentsFn,
          (agent) => o.registerAgentHook(agent),
          o.hooksEnabled,
        );

        if (workspaceFolders && workspaceFolders.length > 1) {
          this.broadcastSink.postMessage({
            type: 'workspaceFolders',
            folders: workspaceFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
          });
          for (const folder of workspaceFolders) {
            const folderProjectDir = getProjectDirPath(folder.uri.fsPath);
            if (folderProjectDir && folderProjectDir !== projectDir) {
              console.log(`[Pixel Agents] Registering additional project dir: ${folderProjectDir}`);
              ensureProjectScan(
                folderProjectDir,
                o.knownJsonlFiles,
                o.projectScanTimer,
                o.activeAgentId,
                o.nextAgentId,
                this.agents,
                o.fileWatchers,
                o.pollingTimers,
                o.waitingTimers,
                o.permissionTimers,
                this.broadcastSink,
                this.persistAgentsFn,
                undefined,
                o.hooksEnabled,
              );
            }
          }
        }

        startExternalSessionScanning(
          projectDir,
          o.knownJsonlFiles,
          o.nextAgentId,
          this.agents,
          o.fileWatchers,
          o.pollingTimers,
          o.waitingTimers,
          o.permissionTimers,
          o.jsonlPollTimers,
          this.broadcastSink,
          this.persistAgentsFn,
          o.watchAllSessions,
          o.hooksEnabled,
        );

        startStaleExternalAgentCheck(
          this.agents,
          o.knownJsonlFiles,
          o.fileWatchers,
          o.pollingTimers,
          o.waitingTimers,
          o.permissionTimers,
          o.jsonlPollTimers,
          this.broadcastSink,
          this.persistAgentsFn,
          o.hooksEnabled,
        );

        // Load assets + layout + send current agent states
        // orchestrator.start() handles asset loading, layout sending, existingAgents + statuses,
        // and layout watcher. The extension-specific path calls sendLayout (which does VS Code
        // workspace state migration) instead of the bare readLayoutFromFile in the orchestrator.
        (async () => {
          try {
            // orchestrator.start() broadcasts assets + layout + agents + starts layout watcher
            await o.start();
            // Override with VS Code-migrated layout (migrateAndLoadLayout reads workspaceState)
            sendLayout(this.context, this.broadcastSink, o.defaultLayout);
            // Re-send agent statuses AFTER layoutLoaded
            sendCurrentAgentStatuses(this.agents, this.broadcastSink);
          } catch (err) {
            console.error('[Extension] Error starting orchestrator:', err);
            // Fallback: still send layout and statuses
            sendLayout(this.context, this.broadcastSink, null);
            sendCurrentAgentStatuses(this.agents, this.broadcastSink);
            o.startLayoutWatcher();
          }
        })();

        sendExistingAgents(this.agents, this.broadcastSink);

        // Seed terminal name tracking
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
      } else {
        // Subsequent webviewReady (e.g. full-screen panel or re-focus):
        // replay current snapshot to only this webview
        if (originWebview) {
          const perViewSink: MessageSink = {
            postMessage: (msg) => originWebview.postMessage(msg),
          };
          void o.replaySnapshotToSink(perViewSink);
        }
      }

      // Always broadcast settings + hook health on webviewReady
      o.broadcastSettingsLoaded();
      const healthState = this.pixelAgentsServer.getHealthState();
      if (healthState && originWebview) {
        void originWebview.postMessage({
          type: 'hookHealthChanged',
          status: healthState.status,
          reason: healthState.reason,
          since: healthState.since,
        });
      }
    } else if (message.type === 'requestDiagnostics') {
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
      await o.reloadAndSendCharacters();
      await o.reloadAndSendFurniture();
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
      await o.reloadAndSendCharacters();
      await o.reloadAndSendFurniture();
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
        o.markLayoutWrite();
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
      const defaultCwd =
        this.config.get<string>(GLOBAL_KEY_DEFAULT_CWD) ?? DEFAULT_SETTINGS.agents.defaultCwd;
      const ok = restartPty(agentId, this.agents, o.ptyManager, defaultCwd, bypass);
      if (ok) {
        this.broadcastSink.postMessage({ type: 'agentRestarted', agentId });
      }
    } else {
      // Delegate remaining settings messages to orchestrator
      o.handleSettingsMessage(message.type as string, message as Record<string, unknown>);
    }
  }

  /** Extension-specific Watch-All handler: prunes non-workspace agents on disable. */
  private handleSetWatchAllSessions(enabled: boolean): void {
    this.config.update(GLOBAL_KEY_WATCH_ALL_SESSIONS, enabled);
    this.orchestrator.watchAllSessions.current = enabled;
    if (enabled) {
      for (const file of this.orchestrator.globalDismissedFiles) {
        dismissedJsonlFiles.delete(file);
      }
      this.orchestrator.globalDismissedFiles.clear();
    } else {
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
          this.orchestrator.globalDismissedFiles.add(agent.jsonlFile);
          this.orchestrator.knownJsonlFiles.delete(agent.jsonlFile);
        }
        removeAgent(
          id,
          this.agents,
          this.orchestrator.fileWatchers,
          this.orchestrator.pollingTimers,
          this.orchestrator.waitingTimers,
          this.orchestrator.permissionTimers,
          this.orchestrator.jsonlPollTimers,
          this.persistAgentsFn,
        );
        this.broadcastSink.postMessage({ type: 'agentClosed', id });
      }
    }
  }

  /** Remove persisted external agents whose projectDir isn't in the current workspace. */
  private pruneForeignExternalsIfWatchAllOff(): void {
    const enabled =
      this.config.get<boolean>(GLOBAL_KEY_WATCH_ALL_SESSIONS) ??
      DEFAULT_SETTINGS.agents.watchAllSessions;
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
        this.orchestrator.globalDismissedFiles.add(agent.jsonlFile);
        this.orchestrator.knownJsonlFiles.delete(agent.jsonlFile);
      }
      removeAgent(
        id,
        this.agents,
        this.orchestrator.fileWatchers,
        this.orchestrator.pollingTimers,
        this.orchestrator.waitingTimers,
        this.orchestrator.permissionTimers,
        this.orchestrator.jsonlPollTimers,
        this.persistAgentsFn,
      );
      this.broadcastSink.postMessage({ type: 'agentClosed', id });
    }
  }

  /** Register VS Code window-level listeners (terminal focus + close). */
  private registerTerminalListeners(): void {
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      this.orchestrator.activeAgentId.current = null;
      if (!terminal) return;
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef && agent.terminalRef === terminal) {
          this.orchestrator.activeAgentId.current = id;
          this.broadcastSink.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef && agent.terminalRef === closed) {
          if (this.orchestrator.activeAgentId.current === id) {
            this.orchestrator.activeAgentId.current = null;
          }
          if (agent.isTeamLead) {
            this.orchestrator.removeTeammates(id);
          }
          dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
          this.orchestrator.unregisterAgentHook(agent);
          removeAgent(
            id,
            this.agents,
            this.orchestrator.fileWatchers,
            this.orchestrator.pollingTimers,
            this.orchestrator.waitingTimers,
            this.orchestrator.permissionTimers,
            this.orchestrator.jsonlPollTimers,
            this.persistAgentsFn,
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

  /** Lazy-init the PtyManager on the first webview, then attach additional
   *  webview sources to the same manager. Delegates to orchestrator. */
  private ensurePtyManager(source: MessageSource): void {
    this.orchestrator.ensurePtyManager(source);
  }

  dispose() {
    if (this.terminalNamePollTimer) {
      clearInterval(this.terminalNamePollTimer);
      this.terminalNamePollTimer = null;
    }
    this.lastSentTerminalNames.clear();
    this.orchestrator.dispose();
    this.pixelAgentsServer.stop();
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

// Re-export for consumers and tests that can't import PixelAgentsViewProvider directly
export { resolveCategoryDefaults } from './settingsDefaults.js';
