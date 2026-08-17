// daemon/uiDispatch.ts
//
// The single UI-message switch shared by both hosts (VS Code extension and
// standalone daemon). Ported verbatim from PixelAgentsViewProvider's
// handleWebviewMessage; host-only actions (dialogs, terminal reveal, first-boot
// init) route through the HostActions seam. Never import `vscode` here — the
// daemon bundle includes this file.
import * as fs from 'fs';

import { launchNewTerminal, resolveDefaultCwd, restartPty } from '../src/agentManager.js';
import { readConfig, writeConfig } from '../src/configPersistence.js';
import type { SettingsCategory } from '../src/constants.js';
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_RECENT_AGENT_FOLDERS,
  RECENT_AGENT_FOLDERS_MAX,
} from '../src/constants.js';
import { writeLayoutToFile } from '../src/layoutPersistence.js';
import type { AgentState, MessageSink } from '../src/types.js';
import type { ConfigStore } from './configStore.js';
import type { Orchestrator } from './orchestrator.js';

export interface HostActions {
  /** Reveal the agent's (or its lead's) host terminal. Daemon: no-op — browser
   *  focus is client-local. */
  focusTerminal(agent: AgentState, lead?: AgentState): void;
  /** Dispose a VS Code-terminal agent's terminalRef (its onDidCloseTerminal
   *  handles cleanup). Daemon: never called — daemon agents have no terminalRef. */
  disposeTerminal(agent: AgentState): void;
  /** Export the saved layout via a host dialog. Daemon: no-op + log (browser
   *  exports client-side as a download). */
  exportLayout(): Promise<void>;
  /** Import a layout via a host open-dialog (used when the message carries no
   *  inline payload). Daemon: no-op + log. */
  importLayoutViaDialog(): Promise<void>;
  /** Open a URI externally. Daemon: no-op + log (browser opens links client-side). */
  openExternal(uri: string): void;
  /** Reveal ~/.claude/projects in the OS file manager. Daemon: no-op + log. */
  openSessionsFolder(): void;
  /** Pick a folder via host dialog; null when unavailable/cancelled. */
  pickExternalAssetDirectory(): Promise<string | null>;
  /** The restartAgent bypass-permissions flag. Extension: workspaceState; daemon: false. */
  getBypassPermissions(): boolean;
  /** Post-launch side effects for newly created agents (extension seeds its
   *  lastSentTerminalNames map here; daemon no-op). */
  onAgentsLaunched(newAgents: AgentState[]): void;
  /** webviewReady handling. Extension: first-boot init + per-view replay.
   *  Daemon: no-op — WS clients replay on connect. */
  onWebviewReady(ctx: DispatchContext): Promise<void>;
}

export interface DispatchContext {
  /** Per-client sink for reply-to-origin messages (diagnostics, snapshot replay). */
  replySink: MessageSink;
  /** true when the message arrived over a WebSocket. WS clients replay on
   *  connect, so hosts suppress webviewReady replay/init for them. */
  isWsClient?: boolean;
}

export interface UiDispatchDeps {
  orchestrator: Orchestrator;
  agents: Map<number, AgentState>;
  broadcastSink: MessageSink;
  config: ConfigStore;
  persistAgents: () => void;
  /** Extension passes context.extensionPath (setHooksEnabled → copyHookScript).
   *  Daemon passes undefined — its hook script is managed at boot. */
  hookScriptSourcePath?: string;
  hostActions: HostActions;
}

/** MRU update for the New-agent form's recent folders list. */
export function updateRecentFolders(current: unknown, added: string, max: number): string[] {
  const list = Array.isArray(current)
    ? current.filter((v): v is string => typeof v === 'string')
    : [];
  return [added, ...list.filter((v) => v !== added)].slice(0, max);
}

export function createUiDispatch(deps: UiDispatchDeps): {
  handle(message: Record<string, unknown>, ctx: DispatchContext): Promise<void>;
} {
  const { orchestrator: o, agents, broadcastSink, config, hostActions } = deps;

  async function handle(message: Record<string, unknown>, ctx: DispatchContext): Promise<void> {
    if (message.type === 'openClaude') {
      const prevAgentIds = new Set(agents.keys());
      await launchNewTerminal(
        o.nextAgentId,
        o.nextTerminalIndex,
        agents,
        o.activeAgentId,
        o.knownJsonlFiles,
        o.fileWatchers,
        o.pollingTimers,
        o.waitingTimers,
        o.permissionTimers,
        o.jsonlPollTimers,
        o.projectScanTimer,
        broadcastSink,
        deps.persistAgents,
        message.folderPath as string | undefined,
        message.bypassPermissions as boolean | undefined,
        config.get<string>(GLOBAL_KEY_DEFAULT_CWD) ?? DEFAULT_SETTINGS.agents.defaultCwd,
        o.ptyManager,
      );
      const newAgents: AgentState[] = [];
      for (const [id, agent] of agents) {
        if (!prevAgentIds.has(id)) {
          o.registerAgentHook(agent);
          newAgents.push(agent);
        }
      }
      hostActions.onAgentsLaunched(newAgents);

      // Optional creation-time name → same slot /rename uses (customTitle):
      // rendered everywhere via characterLabel and replayed to late-joining
      // clients via snapshot replay. NOTE: pty-backed agents are not persisted
      // across host restarts (persistAgents skips them; the pty dies with the
      // process), so — exactly like /rename — the name lives for the session.
      const name = typeof message.name === 'string' ? message.name.trim() : '';
      if (name) {
        for (const agent of newAgents) {
          agent.customTitle = name;
          broadcastSink.postMessage({ type: 'agentRenamed', id: agent.id, customTitle: name });
        }
        deps.persistAgents();
      }

      // Optional creation-time folder → remember it for the New-agent form's
      // recents list (MRU, shared across clients via settingsLoaded). Stored
      // raw (keeps `~` for display); only paths that actually resolve are
      // recorded so a typo never becomes a quick-pick.
      if (typeof message.folderPath === 'string' && message.folderPath.trim()) {
        const raw = message.folderPath.trim();
        if (resolveDefaultCwd(raw)) {
          config.update(
            GLOBAL_KEY_RECENT_AGENT_FOLDERS,
            updateRecentFolders(
              config.get(GLOBAL_KEY_RECENT_AGENT_FOLDERS),
              raw,
              RECENT_AGENT_FOLDERS_MAX,
            ),
          );
          o.broadcastSettingsLoaded();
        }
      }
    } else if (message.type === 'focusAgent') {
      const agent = agents.get(message.id as number);
      if (agent) {
        const lead = agent.leadAgentId !== undefined ? agents.get(agent.leadAgentId) : undefined;
        hostActions.focusTerminal(agent, lead);
      }
    } else if (message.type === 'dismissAwaitingUser') {
      o.dismissAwaitingUser(message.id as number);
    } else if (message.type === 'closeAgent') {
      const agent = agents.get(message.id as number);
      if (agent) {
        if (agent.ptyBacked) {
          o.closeExternalOrPtyAgent(message.id as number);
        } else if (agent.terminalRef) {
          hostActions.disposeTerminal(agent);
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
      const layout = message.layout as Record<string, unknown>;
      o.markLayoutWrite();
      writeLayoutToFile(layout);
      // Single-process hosts have no cross-process file watcher to echo the
      // change, so the broadcast IS the multi-client sync channel. The origin
      // client's dirty-editor guard preserves last-save-wins.
      broadcastSink.postMessage({ type: 'layoutLoaded', layout });
    } else if (message.type === 'setHooksEnabled') {
      o.setHooksEnabled(message.enabled as boolean, deps.hookScriptSourcePath);
    } else if (message.type === 'setWatchAllSessions') {
      o.handleSettingsMessage('setWatchAllSessions', message);
    } else if (message.type === 'restoreCategoryDefaults') {
      const category = message.category as SettingsCategory;
      o.restoreCategoryDefaults(
        category,
        message.values as Partial<(typeof DEFAULT_SETTINGS)[typeof category]> | undefined,
      );
      o.broadcastSettingsLoaded();
    } else if (message.type === 'webviewReady') {
      await hostActions.onWebviewReady(ctx);
    } else if (message.type === 'requestDiagnostics') {
      const diagnostics: Array<Record<string, unknown>> = [];
      for (const [, agent] of agents) {
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
      // Deliberate change from the legacy broadcast: a diagnostics reply
      // belongs to its requester.
      ctx.replySink.postMessage({ type: 'agentDiagnostics', agents: diagnostics });
    } else if (message.type === 'openSessionsFolder') {
      hostActions.openSessionsFolder();
    } else if (message.type === 'exportLayout') {
      await hostActions.exportLayout();
    } else if (message.type === 'addExternalAssetDirectory') {
      const newPath = await hostActions.pickExternalAssetDirectory();
      if (!newPath) return;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      await o.reloadAndSendCharacters();
      await o.reloadAndSendFurniture();
      broadcastSink.postMessage({
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
      broadcastSink.postMessage({
        type: 'externalAssetDirectoriesUpdated',
        dirs: cfg.externalAssetDirectories,
      });
    } else if (message.type === 'importLayout') {
      const inline = message.layout;
      if (inline && typeof inline === 'object') {
        const imported = inline as Record<string, unknown>;
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          console.warn('[Pixel Agents] importLayout: invalid inline layout payload');
          return;
        }
        o.markLayoutWrite();
        writeLayoutToFile(imported);
        broadcastSink.postMessage({ type: 'layoutLoaded', layout: imported });
      } else {
        await hostActions.importLayoutViaDialog();
      }
    } else if (message.type === 'openExternal') {
      const uri = typeof message.uri === 'string' ? message.uri : '';
      if (uri) {
        hostActions.openExternal(uri);
      }
    } else if (message.type === 'acknowledgeCrash') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId === null) return;
      broadcastSink.postMessage({ type: 'crashAcknowledged', agentId });
    } else if (message.type === 'restartAgent') {
      const agentId = typeof message.agentId === 'number' ? message.agentId : null;
      if (agentId === null) return;
      const bypass = hostActions.getBypassPermissions();
      const defaultCwd =
        config.get<string>(GLOBAL_KEY_DEFAULT_CWD) ?? DEFAULT_SETTINGS.agents.defaultCwd;
      const ok = restartPty(agentId, agents, o.ptyManager, defaultCwd, bypass);
      if (ok) {
        broadcastSink.postMessage({ type: 'agentRestarted', agentId });
      }
    } else {
      // Delegate remaining settings messages to orchestrator
      o.handleSettingsMessage(message.type as string, message);
    }
  }

  return { handle };
}
