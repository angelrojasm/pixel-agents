/**
 * daemon/orchestrator.ts — Host-agnostic orchestration core
 *
 * Both the VS Code extension (PixelAgentsViewProvider) and the standalone
 * daemon (bin/serve.ts) call createOrchestrator() with host-specific deps.
 * The orchestrator owns:
 *   - Agent map + all per-agent timers
 *   - HookEventHandler wiring
 *   - File watcher (JSONL polling + project scan + external scan + stale check)
 *   - Asset loading (characters, floor tiles, wall tiles, furniture)
 *   - Layout watcher (cross-window sync)
 *   - PtyManager (lazy-init)
 *   - snapshot-on-WS-connect registration
 *
 * Host-specific code stays in its host:
 *   - Extension: WebviewView/WebviewPanel registration, vscode.window listeners,
 *     multi-webview broadcast set, VS Code terminal adoption.
 *   - Daemon: no VS Code dependencies.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ConfigStore } from './configStore.js';
import { replaySnapshot } from './snapshotReplay.js';
import type { HookEvent } from '../server/src/hookEventHandler.js';
import { HookEventHandler } from '../server/src/hookEventHandler.js';
import { claudeProvider } from '../server/src/providers/index.js';
import type { PixelAgentsServer } from '../server/src/server.js';
import { host } from '../src/hostBridge.js';
import {
  buildExistingAgentsPayload,
  getActiveAgentStatusesSummary,
  getProjectDirPath,
  getRenamedAgentsSummary,
  getTeamInfoSummary,
  getTerminalNamesSummary,
  persistAgents,
  removeAgent,
  sendCurrentAgentStatuses,
  sendExistingAgents,
} from '../src/agentManager.js';
import type { LoadedAssets, LoadedCharacterSprites } from '../src/assetLoader.js';
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
} from '../src/assetLoader.js';
import { readConfig, writeConfig } from '../src/configPersistence.js';
import type { SettingsCategory } from '../src/constants.js';
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_HOOKS_INFO_SHOWN,
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_RECENT_AGENT_FOLDERS,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_TERMINAL_FONT_FAMILY,
  GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
} from '../src/constants.js';
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
} from '../src/fileWatcher.js';
import type { LayoutWatcher } from '../src/layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile } from '../src/layoutPersistence.js';
import { PtyManager } from '../src/pty/ptyManager.js';
import { applyCategoryDefaults } from '../src/settingsDefaults.js';
import { clearAwaitingUser } from '../src/timerManager.js';
import { setHookProvider } from '../src/transcriptParser.js';
import type { AgentState, MessageSink, MessageSource } from '../src/types.js';

// ── Public interface ────────────────────────────────────────────────────────

/** Deps that differ between the VS Code extension and the standalone daemon. */
export interface OrchestratorHostDeps {
  /** Outbound broadcast sink (extension: vscode.Webview fan-out; daemon: WebSocketBroadcast). */
  broadcastSink: MessageSink;

  /** Running PixelAgentsServer instance (already started). */
  server: PixelAgentsServer;

  /** File-backed config store (~/.pixel-agents/config.json). */
  config: ConfigStore;

  /** Absolute path to agents.json. */
  agentsFilePath: string;

  /** Root directory that contains the `assets/` folder (characters, furniture, etc.).
   *  For the extension this is `extensionUri.fsPath/dist`; for the daemon it's
   *  relative to the compiled output dir. Pass `null` to skip asset loading (tests). */
  assetsRoot: string | null;

  /** Extension version string — injected into the settingsLoaded payload.
   *  Daemon passes ''. */
  extensionVersion: string;

  /** Called once when orchestrator.start() completes — lets the host send the
   *  first snapshot to the initial webview / browser tab. */
  onReady?: () => void;

  /** Optional: called by the orchestrator when it needs to remove a teammate
   *  triggered from outside (e.g. team-config polling). Hosts that support
   *  teams wire this; daemon can leave it undefined (hooks handle teams). */
  onTeammateRemoveRequest?: (teammateAgentId: number) => void;
}

/** Public API returned by createOrchestrator(). */
export interface Orchestrator {
  /** Async: loads assets, restores agents, wires file watchers + hook handler. */
  start(): Promise<void>;

  /** Tear everything down (timers, watchers, pty workers). */
  dispose(): void;

  // ── Agent operations ────────────────────────────────────────

  /** The live agent map. Read-only from host perspective; mutations via orchestrator methods. */
  readonly agents: ReadonlyMap<number, AgentState>;

  /** Counter refs shared with agentManager helpers. */
  readonly nextAgentId: { current: number };
  readonly nextTerminalIndex: { current: number };
  readonly activeAgentId: { current: number | null };
  readonly knownJsonlFiles: Set<string>;

  /** Per-agent timer maps (needed by launchNewTerminal and agentManager). */
  readonly fileWatchers: Map<number, fs.FSWatcher>;
  readonly pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  readonly waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  readonly permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  readonly jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
  readonly projectScanTimer: { current: ReturnType<typeof setInterval> | null };

  /** Whether Watch-All is currently enabled (mutable ref). */
  readonly watchAllSessions: { current: boolean };

  /** Whether hooks mode is active (mutable ref). */
  readonly hooksEnabled: { current: boolean };

  /** Global-dismissed files (for Watch-All toggle). */
  readonly globalDismissedFiles: Set<string>;

  /** Default layout loaded from bundled assets. */
  readonly defaultLayout: Record<string, unknown> | null;

  /** Current PtyManager instance (null until first ensurePtyManager call). */
  readonly ptyManager: PtyManager | null;

  /** Lazy-init the PtyManager (first call creates it; every call attaches the
   *  source to the same manager). `replySink` receives that client's
   *  ptyScrollback replies. Returns the attachment's disposable — hosts must
   *  dispose it when the client (webview / WS socket) goes away. */
  ensurePtyManager(source: MessageSource, replySink?: MessageSink): { dispose(): void };

  /** Persist the agents map to agents.json immediately. */
  persistNow(): void;

  /** Layout watcher — exposes markOwnWrite() to the host (e.g. on saveLayout). */
  readonly layoutWatcher: LayoutWatcher | null;

  // ── Snapshot / settings helpers ─────────────────────────────

  /** Build the settings payload for settingsLoaded messages. */
  buildSettingsPayload(): Record<string, unknown>;

  /** Broadcast settingsLoaded to all sinks. */
  broadcastSettingsLoaded(): void;

  /** Send the full snapshot (assets + agents + settings) to a specific sink.
   *  Used by the extension on webviewReady to replay state to a newly-mounted webview. */
  replaySnapshotToSink(sink: MessageSink): Promise<void>;

  // ── Agent hook registration ─────────────────────────────────
  registerAgentHook(agent: AgentState): void;
  unregisterAgentHook(agent: AgentState): void;

  // ── Team management ─────────────────────────────────────────
  removeTeammate(teammateAgentId: number, source: string): void;
  removeTeammates(leadId: number): void;

  // ── Mutation helpers called from host message handlers ──────

  /** Handle settings change from webview message. Returns whether broadcast is needed. */
  handleSettingsMessage(
    type: string,
    payload: Record<string, unknown>,
  ): 'broadcast-settings' | 'handled' | 'unknown';

  /** Update hook install/uninstall based on new enabled state. Both hosts route
   *  here via the shared dispatch; `extensionPath` (copyHookScript source) is
   *  extension-only — the daemon's hook script is managed at boot. */
  setHooksEnabled(enabled: boolean, extensionPath?: string): void;

  /** Run restoreCategoryDefaults for a settings category. */
  restoreCategoryDefaults(
    category: SettingsCategory,
    values: Partial<(typeof DEFAULT_SETTINGS)[SettingsCategory]> | undefined,
  ): void;

  /** Persist agent seat data (palette, hueShift, workSeatId) from webview. */
  saveAgentSeats(
    seats: Record<number, { palette: number; hueShift: number; workSeatId: string | null }>,
  ): void;

  /** Handle dismissAwaitingUser from webview. */
  dismissAwaitingUser(agentId: number): void;

  /** Handle closeAgent for external/pty agents (terminal agents handled by host). */
  closeExternalOrPtyAgent(agentId: number): void;

  /** Start layout watcher (idempotent — safe to call multiple times). */
  startLayoutWatcher(): void;

  /** Ensure layout watcher marks its own write before the host calls writeLayoutToFile. */
  markLayoutWrite(): void;

  /** Reload external asset directories and send updated assets to sink. */
  reloadAndSendCharacters(): Promise<void>;
  reloadAndSendFurniture(): Promise<void>;
}

// ── Implementation ────────────────────────────────────────────────────────

export function createOrchestrator(hostDeps: OrchestratorHostDeps): Orchestrator {
  const { broadcastSink, server, config, agentsFilePath, assetsRoot } = hostDeps;

  // ── Mutable agent state ────────────────────────────────────
  const agents = new Map<number, AgentState>();
  const nextAgentId = { current: 1 };
  const nextTerminalIndex = { current: 1 };
  const activeAgentId = { current: null as number | null };
  const knownJsonlFiles = new Set<string>();

  // ── Per-agent timer maps ───────────────────────────────────
  const fileWatchers = new Map<number, fs.FSWatcher>();
  const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  const projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

  // ── Global scan state ──────────────────────────────────────
  const watchAllSessions = { current: false };
  const hooksEnabled = { current: true };
  const globalDismissedFiles = new Set<string>();

  // ── External scan timers ───────────────────────────────────
  let externalScanTimer: ReturnType<typeof setInterval> | null = null;
  let staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ── Cached assets (for snapshot-on-connect replay) ─────────
  let cachedCharacterSprites: unknown = null;
  let cachedFloorTiles: unknown = null;
  let cachedWallTiles: unknown = null;
  let cachedFurnitureAssets: { catalog: unknown; sprites?: unknown } | null = null;
  let defaultLayout: Record<string, unknown> | null = null;

  // ── Sub-systems (lazy-init) ────────────────────────────────
  let layoutWatcher: LayoutWatcher | null = null;
  // Wrapped in an object so TypeScript closure analysis doesn't narrow to null
  const ptyRef: { manager: PtyManager | null } = { manager: null };

  // ── HookEventHandler ──────────────────────────────────────
  const doPersist = (): void => {
    persistAgents(agents, agentsFilePath, nextAgentId, nextTerminalIndex);
  };

  const hookEventHandler = new HookEventHandler(
    agents,
    waitingTimers,
    permissionTimers,
    () => broadcastSink,
    claudeProvider,
    watchAllSessions,
  );

  if (claudeProvider.team) {
    setTeamProvider(claudeProvider.team);
  }
  setHookProvider(claudeProvider);
  setTeammateRemovalCallback((id) => self.removeTeammate(id, 'team-config'));

  hookEventHandler.setLifecycleCallbacks({
    onExternalSessionDetected: (sessionId, transcriptPath, cwd) => {
      const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
      if (!isTrackedProjectDir(projectDir) && !watchAllSessions.current) {
        return;
      }
      adoptExternalSessionFromHook(
        sessionId,
        transcriptPath,
        cwd,
        knownJsonlFiles,
        nextAgentId,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        broadcastSink,
        doPersist,
        (agent) => self.registerAgentHook(agent),
      );
    },
    onSessionClear: (agentId, newSessionId, newTranscriptPath) => {
      if (newTranscriptPath) {
        knownJsonlFiles.add(newTranscriptPath);
        reassignAgentToFile(
          agentId,
          newTranscriptPath,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          broadcastSink,
          doPersist,
        );
      }
      const agent = agents.get(agentId);
      if (agent) {
        self.unregisterAgentHook(agent);
        agent.sessionId = newSessionId;
        self.registerAgentHook(agent);
      }
    },
    onSessionResume: (transcriptPath) => {
      dismissedJsonlFiles.delete(transcriptPath);
      seededMtimes.delete(transcriptPath);
      knownJsonlFiles.delete(transcriptPath);
    },
    onTeammateDetected: (parentAgentId, sessionId, _agentType) => {
      const parentAgent = agents.get(parentAgentId);
      if (!parentAgent) return;
      scanForTeammateFiles(
        parentAgent.projectDir,
        sessionId,
        parentAgentId,
        nextAgentId,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        broadcastSink,
        doPersist,
        (agent) => self.registerAgentHook(agent),
      );
    },
    onTeammateRemoved: (teammateAgentId) => {
      self.removeTeammate(teammateAgentId, 'hooks');
    },
    onSessionEnd: (agentId) => {
      const agent = agents.get(agentId);
      if (!agent) return;
      seededMtimes.delete(agent.jsonlFile);
      dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
      if (agent.isTeamLead) {
        self.removeTeammates(agentId);
      }
      if (agent.isExternal) {
        self.unregisterAgentHook(agent);
        removeAgent(
          agentId,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          doPersist,
        );
        broadcastSink.postMessage({ type: 'agentClosed', id: agentId });
      }
    },
  });

  // Wire server hook events → handler
  server.onHookEvent((providerId, event) => {
    hookEventHandler.handleEvent(providerId, event as HookEvent);
  });

  // Wire server health changes → broadcast
  server.onHealthChange((state) => {
    broadcastSink.postMessage({
      type: 'hookHealthChanged',
      status: state.status,
      reason: state.reason,
      since: state.since,
    });
  });

  // NOTE: WS-connect wiring (snapshot replay, pty attach, UI dispatch) is
  // host-owned — see bin/serve.ts (daemon) and PixelAgentsViewProvider
  // (extension). Both call replaySnapshotToSink(perClientSink) on connect.

  // ── Asset loading helpers ──────────────────────────────────

  async function loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!assetsRoot) return null;
    let assets = await loadFurnitureAssets(assetsRoot);
    const cfg = readConfig();
    for (const extraDir of cfg.externalAssetDirectories) {
      console.log('[Orchestrator] Loading external assets from:', extraDir);
      const extra = await loadFurnitureAssets(extraDir);
      if (extra) {
        assets = assets ? mergeLoadedAssets(assets, extra) : extra;
      }
    }
    return assets;
  }

  async function loadAllCharacterSprites(): Promise<LoadedCharacterSprites | null> {
    if (!assetsRoot) return null;
    let chars = await loadCharacterSprites(assetsRoot);
    const cfg = readConfig();
    for (const extraDir of cfg.externalAssetDirectories) {
      console.log('[Orchestrator] Loading external character sprites from:', extraDir);
      const extra = await loadExternalCharacterSprites(extraDir);
      if (extra) {
        chars = chars ? mergeCharacterSprites(chars, extra) : extra;
      }
    }
    return chars;
  }

  // ── Public API object (self-reference for callbacks) ──────
  const self: Orchestrator = {
    get agents() {
      return agents as ReadonlyMap<number, AgentState>;
    },
    nextAgentId,
    nextTerminalIndex,
    activeAgentId,
    knownJsonlFiles,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    jsonlPollTimers,
    projectScanTimer,
    watchAllSessions,
    hooksEnabled,
    globalDismissedFiles,
    get defaultLayout() {
      return defaultLayout;
    },
    get ptyManager() {
      return ptyRef.manager;
    },
    ensurePtyManager(source: MessageSource, replySink?: MessageSink): { dispose(): void } {
      if (ptyRef.manager === null) {
        ptyRef.manager = new PtyManager({ sink: broadcastSink });
      }
      return ptyRef.manager.attachSource(source, replySink);
    },

    persistNow(): void {
      doPersist();
    },
    get layoutWatcher() {
      return layoutWatcher;
    },

    async start(): Promise<void> {
      // Sync mutable refs from config
      watchAllSessions.current =
        config.get<boolean>(GLOBAL_KEY_WATCH_ALL_SESSIONS) ??
        DEFAULT_SETTINGS.agents.watchAllSessions;
      hooksEnabled.current =
        config.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED) ?? DEFAULT_SETTINGS.agents.hooksEnabled;

      // Register already-restored agents with the hook handler.
      // The host (extension or daemon) populates agents before calling start().
      // Extension: calls restoreAgents() in webviewReady before start().
      // Daemon: agents may be empty on first boot (pruneDeadAgents ran in startDaemon).
      for (const agent of agents.values()) {
        self.registerAgentHook(agent);
      }

      // Start project-level scanners
      const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
      const projectDir = projectsRoot; // daemon scans all project dirs via external scanner
      ensureProjectScan(
        projectDir,
        knownJsonlFiles,
        projectScanTimer,
        activeAgentId,
        nextAgentId,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        broadcastSink,
        doPersist,
        undefined,
        hooksEnabled,
      );

      if (!externalScanTimer) {
        externalScanTimer = startExternalSessionScanning(
          projectDir,
          knownJsonlFiles,
          nextAgentId,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          broadcastSink,
          doPersist,
          watchAllSessions,
          hooksEnabled,
        );
      }

      if (!staleCheckTimer) {
        staleCheckTimer = startStaleExternalAgentCheck(
          agents,
          knownJsonlFiles,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          broadcastSink,
          doPersist,
          hooksEnabled,
        );
      }

      // Load assets
      if (assetsRoot) {
        try {
          defaultLayout = loadDefaultLayout(assetsRoot);

          const charSprites = await loadAllCharacterSprites();
          if (charSprites) {
            cachedCharacterSprites = charSprites.characters;
            sendCharacterSpritesToWebview(broadcastSink, charSprites);
          }

          const floorTiles = await loadFloorTiles(assetsRoot);
          if (floorTiles) {
            cachedFloorTiles = floorTiles.sprites;
            sendFloorTilesToWebview(broadcastSink, floorTiles);
          }

          const wallTiles = await loadWallTiles(assetsRoot);
          if (wallTiles) {
            cachedWallTiles = wallTiles.sets;
            sendWallTilesToWebview(broadcastSink, wallTiles);
          }

          const furnitureAssets = await loadAllFurnitureAssets();
          if (furnitureAssets) {
            const spritesObj: Record<string, string[][]> = {};
            for (const [id, spriteData] of furnitureAssets.sprites) {
              spritesObj[id] = spriteData;
            }
            cachedFurnitureAssets = { catalog: furnitureAssets.catalog, sprites: spritesObj };
            sendAssetsToWebview(broadcastSink, furnitureAssets);
          }
        } catch (err) {
          console.error('[Orchestrator] Error loading assets:', err);
        }

        // Send layout after assets so renderer can paint immediately
        const layout = readLayoutFromFile();
        if (layout) {
          broadcastSink.postMessage({ type: 'layoutLoaded', layout });
        } else if (defaultLayout) {
          broadcastSink.postMessage({ type: 'layoutLoaded', layout: defaultLayout });
        }
      }

      // Send current agent states to any already-connected clients
      sendExistingAgents(agents, broadcastSink);
      sendCurrentAgentStatuses(agents, broadcastSink);

      // Start layout file watcher
      self.startLayoutWatcher();

      hostDeps.onReady?.();
    },

    dispose(): void {
      hookEventHandler.dispose();
      ptyRef.manager?.disposeAll();
      layoutWatcher?.dispose();
      if (projectScanTimer.current) {
        clearInterval(projectScanTimer.current);
        projectScanTimer.current = null;
      }
      if (externalScanTimer) {
        clearInterval(externalScanTimer);
        externalScanTimer = null;
      }
      if (staleCheckTimer) {
        clearInterval(staleCheckTimer);
        staleCheckTimer = null;
      }
      for (const id of [...agents.keys()]) {
        removeAgent(
          id,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          jsonlPollTimers,
          doPersist,
        );
      }
    },

    buildSettingsPayload(): Record<string, unknown> {
      const soundEnabled =
        config.get<boolean>(GLOBAL_KEY_SOUND_ENABLED) ?? DEFAULT_SETTINGS.general.soundEnabled;
      const lastSeenVersion = config.get<string>(GLOBAL_KEY_LAST_SEEN_VERSION) ?? '';
      const watchAll =
        config.get<boolean>(GLOBAL_KEY_WATCH_ALL_SESSIONS) ??
        DEFAULT_SETTINGS.agents.watchAllSessions;
      const alwaysShowLabels =
        config.get<boolean>(GLOBAL_KEY_ALWAYS_SHOW_LABELS) ??
        DEFAULT_SETTINGS.general.alwaysShowLabels;
      const showTerminalNames =
        config.get<boolean>(GLOBAL_KEY_SHOW_TERMINAL_NAMES) ??
        DEFAULT_SETTINGS.general.showTerminalNames;
      const hooks =
        config.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED) ?? DEFAULT_SETTINGS.agents.hooksEnabled;
      const hooksInfoShown = config.get<boolean>(GLOBAL_KEY_HOOKS_INFO_SHOWN) ?? false;
      const defaultCwd =
        config.get<string>(GLOBAL_KEY_DEFAULT_CWD) ?? DEFAULT_SETTINGS.agents.defaultCwd;
      const officeConfig = readConfig();
      return {
        soundEnabled,
        lastSeenVersion,
        extensionVersion: hostDeps.extensionVersion,
        watchAllSessions: watchAll,
        alwaysShowLabels,
        showTerminalNames,
        hooksEnabled: hooks,
        hooksInfoShown,
        defaultCwd,
        recentAgentFolders: (config.get<unknown[]>(GLOBAL_KEY_RECENT_AGENT_FOLDERS) ?? []).filter(
          (v): v is string => typeof v === 'string',
        ),
        externalAssetDirectories: officeConfig.externalAssetDirectories,
        terminalFontFamily:
          config.get<string>(GLOBAL_KEY_TERMINAL_FONT_FAMILY) ??
          DEFAULT_SETTINGS.terminal.fontFamily,
        terminalLineHeight:
          config.get<number>(GLOBAL_KEY_TERMINAL_LINE_HEIGHT) ??
          DEFAULT_SETTINGS.terminal.lineHeight,
      };
    },

    broadcastSettingsLoaded(): void {
      broadcastSink.postMessage({
        type: 'settingsLoaded',
        ...self.buildSettingsPayload(),
      });
    },

    async replaySnapshotToSink(sink: MessageSink): Promise<void> {
      await replaySnapshot({
        sink,
        getCharacterSprites: () => cachedCharacterSprites ?? [],
        getFloorTiles: () => cachedFloorTiles ?? [],
        getWallTiles: () => cachedWallTiles ?? [],
        getFurnitureAssets: () => cachedFurnitureAssets ?? { catalog: [] },
        getExistingAgentsPayload: () => buildExistingAgentsPayload(agents),
        getLayout: () => readLayoutFromFile() ?? defaultLayout,
        getSettings: () => self.buildSettingsPayload(),
        getHookHealth: () => {
          const h = server.getHealthState();
          return h ? { status: h.status, reason: h.reason, since: h.since } : null;
        },
        getRenamedAgents: () => getRenamedAgentsSummary(agents),
        getTeamInfo: () => getTeamInfoSummary(agents),
        getTerminalNameChanges: () => getTerminalNamesSummary(agents),
        getActiveAgentStatuses: () => getActiveAgentStatusesSummary(agents),
      });
    },

    registerAgentHook(agent: AgentState): void {
      hookEventHandler.registerAgent(agent.sessionId, agent.id);
    },

    unregisterAgentHook(agent: AgentState): void {
      hookEventHandler.unregisterAgent(agent.sessionId);
    },

    removeTeammate(teammateAgentId: number, source: string): void {
      const agent = agents.get(teammateAgentId);
      if (!agent) return;
      console.log(`[Orchestrator] Removing teammate ${teammateAgentId} (source: ${source})`);
      dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
      self.unregisterAgentHook(agent);
      removeAgent(
        teammateAgentId,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        jsonlPollTimers,
        doPersist,
      );
      broadcastSink.postMessage({ type: 'agentClosed', id: teammateAgentId });
    },

    removeTeammates(leadId: number): void {
      const teammates: number[] = [];
      for (const [id, agent] of agents) {
        if (agent.leadAgentId === leadId) {
          teammates.push(id);
        }
      }
      for (const id of teammates) {
        const agent = agents.get(id);
        if (agent) {
          console.log(`[Orchestrator] Removing teammate ${id} (lead ${leadId} closed)`);
          dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
          self.unregisterAgentHook(agent);
          removeAgent(
            id,
            agents,
            fileWatchers,
            pollingTimers,
            waitingTimers,
            permissionTimers,
            jsonlPollTimers,
            doPersist,
          );
          broadcastSink.postMessage({ type: 'agentClosed', id });
        }
      }
    },

    handleSettingsMessage(
      type: string,
      payload: Record<string, unknown>,
    ): 'broadcast-settings' | 'handled' | 'unknown' {
      if (type === 'setSoundEnabled') {
        config.update(GLOBAL_KEY_SOUND_ENABLED, payload.enabled);
        return 'handled';
      }
      if (type === 'setLastSeenVersion') {
        config.update(GLOBAL_KEY_LAST_SEEN_VERSION, payload.version as string);
        return 'handled';
      }
      if (type === 'setAlwaysShowLabels') {
        config.update(GLOBAL_KEY_ALWAYS_SHOW_LABELS, payload.enabled);
        return 'handled';
      }
      if (type === 'setShowTerminalNames') {
        config.update(GLOBAL_KEY_SHOW_TERMINAL_NAMES, payload.enabled);
        return 'handled';
      }
      if (type === 'setDefaultCwd') {
        config.update(GLOBAL_KEY_DEFAULT_CWD, (payload.value as string) ?? '');
        return 'handled';
      }
      if (type === 'setHooksInfoShown') {
        config.update(GLOBAL_KEY_HOOKS_INFO_SHOWN, true);
        return 'handled';
      }
      if (type === 'setTerminalFontFamily') {
        const value =
          typeof payload.value === 'string' ? payload.value : DEFAULT_SETTINGS.terminal.fontFamily;
        config.update(GLOBAL_KEY_TERMINAL_FONT_FAMILY, value);
        return 'handled';
      }
      if (type === 'setTerminalLineHeight') {
        const value =
          typeof payload.value === 'number' && Number.isFinite(payload.value)
            ? payload.value
            : DEFAULT_SETTINGS.terminal.lineHeight;
        config.update(GLOBAL_KEY_TERMINAL_LINE_HEIGHT, value);
        return 'handled';
      }
      if (type === 'setDebugMode') {
        // debugMode is webview-local; echo to all webviews for multi-webview sync
        broadcastSink.postMessage({ type: 'setDebugMode', enabled: payload.enabled as boolean });
        return 'handled';
      }
      if (type === 'setWatchAllSessions') {
        const enabled = payload.enabled as boolean;
        config.update(GLOBAL_KEY_WATCH_ALL_SESSIONS, enabled);
        watchAllSessions.current = enabled;
        if (enabled) {
          for (const file of globalDismissedFiles) {
            dismissedJsonlFiles.delete(file);
          }
          globalDismissedFiles.clear();
        } else {
          // Remove external agents not from the current workspace. The daemon
          // host bridge reports no workspace folders, so every external is
          // "outside" there — same behavior as before unification.
          const workspaceDirs = new Set<string>();
          for (const folder of host().workspaceFolders()) {
            const dir = getProjectDirPath(folder);
            if (dir) workspaceDirs.add(dir);
          }
          const toRemove: number[] = [];
          for (const [id, agent] of agents) {
            if (agent.isExternal && !workspaceDirs.has(agent.projectDir)) {
              toRemove.push(id);
            }
          }
          for (const id of toRemove) {
            const agent = agents.get(id);
            if (agent) {
              dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
              globalDismissedFiles.add(agent.jsonlFile);
              knownJsonlFiles.delete(agent.jsonlFile);
            }
            removeAgent(
              id,
              agents,
              fileWatchers,
              pollingTimers,
              waitingTimers,
              permissionTimers,
              jsonlPollTimers,
              doPersist,
            );
            broadcastSink.postMessage({ type: 'agentClosed', id });
          }
        }
        return 'handled';
      }
      if (type === 'restoreCategoryDefaults') {
        const category = payload.category as SettingsCategory;
        self.restoreCategoryDefaults(
          category,
          payload.values as Partial<(typeof DEFAULT_SETTINGS)[SettingsCategory]> | undefined,
        );
        self.broadcastSettingsLoaded();
        return 'handled';
      }
      return 'unknown';
    },

    setHooksEnabled(enabled: boolean, extensionPath?: string): void {
      config.update(GLOBAL_KEY_HOOKS_ENABLED, enabled);
      hooksEnabled.current = enabled;
      if (enabled) {
        // Dynamic import to avoid pulling vscode into daemon path
        import('../server/src/providers/hook/claude/claudeHookInstaller.js')
          .then((m) => m.installHooks())
          .catch((e) => console.error('[Orchestrator] installHooks failed:', e));
        if (extensionPath) {
          import('../server/src/providers/index.js')
            .then((m) => m.copyHookScript(extensionPath))
            .catch((e) => console.error('[Orchestrator] copyHookScript failed:', e));
        }
        console.log('[Orchestrator] Hooks enabled');
      } else {
        import('../server/src/providers/hook/claude/claudeHookInstaller.js')
          .then((m) => m.uninstallHooks())
          .catch((e) => console.error('[Orchestrator] uninstallHooks failed:', e));
        console.log('[Orchestrator] Hooks disabled');
      }
    },

    restoreCategoryDefaults(
      category: SettingsCategory,
      values: Partial<(typeof DEFAULT_SETTINGS)[SettingsCategory]> | undefined,
    ): void {
      applyCategoryDefaults(category, values, {
        config,
        broadcast: broadcastSink,
        office: { read: readConfig, write: writeConfig },
      });
    },

    saveAgentSeats(
      seats: Record<number, { palette: number; hueShift: number; workSeatId: string | null }>,
    ): void {
      for (const [rawId, seat] of Object.entries(seats)) {
        const id = Number(rawId);
        const agent = agents.get(id);
        if (agent) {
          agent.palette = seat.palette ?? 0;
          agent.hueShift = seat.hueShift ?? 0;
          agent.workSeatId = seat.workSeatId ?? undefined;
        }
      }
      doPersist();
    },

    dismissAwaitingUser(agentId: number): void {
      const agent = agents.get(agentId);
      clearAwaitingUser(agentId, agent);
      hookEventHandler.clearAwaitingUser(agentId);
      broadcastSink.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'idle',
      });
    },

    closeExternalOrPtyAgent(agentId: number): void {
      const agent = agents.get(agentId);
      if (!agent) return;
      dismissedJsonlFiles.set(agent.jsonlFile, Date.now());
      if (agent.ptyBacked) {
        ptyRef.manager?.stop(agentId);
      }
      removeAgent(
        agentId,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        jsonlPollTimers,
        doPersist,
      );
      broadcastSink.postMessage({ type: 'agentClosed', id: agentId });
    },

    startLayoutWatcher(): void {
      if (layoutWatcher) return;
      layoutWatcher = watchLayoutFile((layout) => {
        console.log('[Orchestrator] External layout change — pushing to sink');
        broadcastSink.postMessage({ type: 'layoutLoaded', layout });
      });
    },

    markLayoutWrite(): void {
      layoutWatcher?.markOwnWrite();
    },

    async reloadAndSendCharacters(): Promise<void> {
      if (!assetsRoot) return;
      try {
        const chars = await loadAllCharacterSprites();
        if (chars) {
          cachedCharacterSprites = chars.characters;
          sendCharacterSpritesToWebview(broadcastSink, chars);
        }
      } catch (err) {
        console.error('[Orchestrator] Error reloading character sprites:', err);
      }
    },

    async reloadAndSendFurniture(): Promise<void> {
      if (!assetsRoot) return;
      try {
        const assets = await loadAllFurnitureAssets();
        if (assets) {
          const spritesObj: Record<string, string[][]> = {};
          for (const [id, spriteData] of assets.sprites) {
            spritesObj[id] = spriteData;
          }
          cachedFurnitureAssets = { catalog: assets.catalog, sprites: spritesObj };
          sendAssetsToWebview(broadcastSink, assets);
        }
      } catch (err) {
        console.error('[Orchestrator] Error reloading furniture assets:', err);
      }
    },
  };

  return self;
}
