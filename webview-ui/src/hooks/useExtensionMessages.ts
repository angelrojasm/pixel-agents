import { useCallback, useEffect, useRef, useState } from 'react';

import { playDoneSound, playPermissionSound, setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { rememberSavedLayout } from '../office/layoutFile.js';
import { PtyEventBus } from '../office/panel/ptyEventBus.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { vscode } from '../vscodeApi.js';
import { applyCrashAction, crashInitialState, type CrashState } from './crashReducer.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  setWatchAllSessions: (v: boolean) => void;
  alwaysShowLabels: boolean;
  showTerminalNames: boolean;
  soundEnabled: boolean;
  hooksEnabled: boolean;
  setHooksEnabled: (v: boolean) => void;
  hooksInfoShown: boolean;
  defaultCwd: string;
  setDefaultCwd: (v: string) => void;
  /** MRU folders from the New-agent form (config.json, newest first). */
  recentAgentFolders: string[];
  terminalFontFamily: string;
  terminalLineHeight: number;
  setTerminalFontFamily: (v: string) => void;
  setTerminalLineHeight: (v: number) => void;
  ptyEventBus: PtyEventBus;
  ptyBackedByAgent: Record<number, boolean>;
  agentRenameSeq: number;
  crashState: CrashState;
  hookHealth: { status: 'ok' | 'degraded' | 'down'; reason?: string };
  acknowledgeCrash: (agentId: number) => void;
  restartAgent: (agentId: number) => void;
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; workSeatId: string | null }> =
    {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, workSeatId: ch.workSeatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
  onSetDebugMode?: (enabled: boolean) => void,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset, setLayoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [externalAssetDirectories, setExternalAssetDirectories] = useState<string[]>([]);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [watchAllSessions, setWatchAllSessions] = useState(false);
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);
  const [showTerminalNames, setShowTerminalNames] = useState(true);
  const [soundEnabledState, setSoundEnabledState] = useState(true);
  const [hooksEnabled, setHooksEnabled] = useState(true);
  const [hooksInfoShown, setHooksInfoShown] = useState(true);
  const [defaultCwd, setDefaultCwdState] = useState('');
  const [terminalFontFamily, setTerminalFontFamilyState] = useState(
    'Menlo, Monaco, "Courier New", monospace',
  );
  const [terminalLineHeight, setTerminalLineHeightState] = useState(1.0);
  const [recentAgentFolders, setRecentAgentFolders] = useState<string[]>([]);
  const [ptyBackedByAgent, setPtyBackedByAgent] = useState<Record<number, boolean>>({});
  const [agentRenameSeq, setAgentRenameSeq] = useState(0);
  const [crashState, setCrashState] = useState<CrashState>(crashInitialState);
  const [hookHealth, setHookHealth] = useState<{
    status: 'ok' | 'degraded' | 'down';
    reason?: string;
  }>({
    status: 'ok',
  });

  const acknowledgeCrash = useCallback(
    (agentId: number) => {
      const os = getOfficeState();
      os.acknowledgeCrash(agentId);
      setCrashState((prev) => applyCrashAction(prev, { type: 'crashAcknowledged', agentId }));
      vscode.postMessage({ type: 'acknowledgeCrash', agentId });
    },
    [getOfficeState],
  );

  const restartAgent = useCallback((agentId: number) => {
    vscode.postMessage({ type: 'restartAgent', agentId });
  }, []);

  const setDefaultCwd = (v: string): void => {
    setDefaultCwdState(v);
    vscode.postMessage({ type: 'setDefaultCwd', value: v });
  };

  const setTerminalFontFamily = (v: string): void => {
    setTerminalFontFamilyState(v);
    vscode.postMessage({ type: 'setTerminalFontFamily', value: v });
  };

  const setTerminalLineHeight = (v: number): void => {
    setTerminalLineHeightState(v);
    vscode.postMessage({ type: 'setTerminalLineHeight', value: v });
  };

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  const ptyEventBusRef = useRef<PtyEventBus>(new PtyEventBus());

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      folderName?: string;
      terminalName?: string;
    }> = [];

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      const os = getOfficeState();

      if (msg.type === 'layoutLoaded') {
        // Keep the raw (pre-migration) payload for browser-runtime export.
        // MUST happen before the dirty guard: export promises last-SAVED state
        // even when this tab's editor skips the visual update below.
        rememberSavedLayout(msg.layout);
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName, p.terminalName);
        }
        pendingAgents = [];
        layoutReadyRef.current = true;
        setLayoutReady(true);
        if (msg.wasReset) {
          setLayoutWasReset(true);
        }
        if (os.characters.size > 0) {
          saveAgentSeats(os);
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number;
        const folderName = msg.folderName as string | undefined;
        const terminalName = msg.terminalName as string | undefined;
        const isTeammate = msg.isTeammate as boolean | undefined;
        const teammateName = msg.teammateName as string | undefined;
        const teammateParentId = msg.parentAgentId as number | undefined;
        const teamName = msg.teamName as string | undefined;
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        if (msg.ptyBacked === true) {
          setPtyBackedByAgent((prev) => ({ ...prev, [id]: true }));
        }
        // Don't auto-select teammates (keep focus on lead)
        if (!isTeammate) {
          setSelectedAgent(id);
        }
        if (isTeammate && teammateParentId !== undefined) {
          // Teammate: inherit parent's palette and workspace folderName (teammate runs
          // in the same workspace as the lead). Name shown via agentName (teamRoleLabel).
          const parentCh = os.characters.get(teammateParentId);
          const palette = parentCh ? parentCh.palette : undefined;
          const hueShift = parentCh ? parentCh.hueShift : undefined;
          os.addAgent(id, palette, hueShift, undefined, undefined, parentCh?.folderName);
          // Set team metadata on the character
          const ch = os.characters.get(id);
          if (ch) {
            ch.leadAgentId = teammateParentId;
            ch.teamName = teamName ?? parentCh?.teamName;
            ch.agentName = teammateName;
          }
        } else {
          os.addAgent(id, undefined, undefined, undefined, undefined, folderName, terminalName);
        }
        saveAgentSeats(os);
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setPtyBackedByAgent((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.removeAgent(id);
        setCrashState((prev) => applyCrashAction(prev, { type: 'agentClosed', agentId: id }));
      } else if (msg.type === 'agentTerminalNameChanged') {
        const id = msg.id as number;
        const terminalName = msg.terminalName as string;
        os.setAgentTerminalName(id, terminalName);
        setAgentRenameSeq((n) => n + 1);
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string; workSeatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        const terminalNames = (msg.terminalNames || {}) as Record<number, string>;
        const ptyBackedAgents = (msg.ptyBackedAgents || {}) as Record<number, boolean>;
        // Buffer agents — they'll be added in layoutLoaded after seats are built
        for (const id of incoming) {
          const m = meta[id];
          pendingAgents.push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.workSeatId ?? m?.seatId,
            folderName: folderNames[id],
            terminalName: terminalNames[id],
          });
        }
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
        setPtyBackedByAgent((prev) => {
          const next = { ...prev };
          for (const id of incoming) {
            if (ptyBackedAgents[id] === true) next[id] = true;
          }
          return next;
        });
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        const permissionActive = msg.permissionActive as boolean | undefined;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: [
              ...list,
              { toolId, status, done: false, permissionWait: permissionActive || false },
            ],
          };
        });
        const toolName = (msg.toolName as string | undefined) ?? extractToolName(status);
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        // Don't clear the permission bubble if the hook already confirmed permission is needed
        if (!permissionActive) {
          os.clearPermissionBubble(id);
        }
        // Create sub-agent character for Task/Agent tool subtasks.
        // In tmux / inline teams mode, Agent tool has run_in_background=true -- those
        // are handled via the independent teammate path (onTeammateDetected), not here.
        // runInBackground gates them out so we don't create ghost sub-agents for them.
        //
        // Skip creation for synthetic hook-ids. Later SubagentStop/subagentClear use
        // the REAL tool id from JSONL; creating with a synthetic id would orphan the
        // sub-agent (mismatched keys). JSONL's agentToolStart (with real id) handles
        // creation in both hooks and heuristic modes -- ~500ms delay vs instant hook.
        const runInBackground = msg.runInBackground as boolean | undefined;
        if (
          (toolName === 'Task' || toolName === 'Agent') &&
          !runInBackground &&
          !toolId.startsWith('hook-')
        ) {
          const label = status.startsWith('Subtask:') ? status.slice('Subtask:'.length).trim() : '';
          const subId = os.addSubagent(id, toolId);
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev;
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent.
        // Exception: team leads with inline teammates -- their sub-agents represent
        // real teammates and should only be removed by SubagentStop/subagentClear.
        const clearCh = os.characters.get(id);
        const hasInlineTeammates =
          clearCh?.teamName && clearCh?.isTeamLead && !clearCh?.teamUsesTmux;
        if (!hasInlineTeammates) {
          os.removeAllSubagents(id);
          setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        }
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        setAgentStatuses((prev) => {
          if (status === 'active' || status === 'idle') {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os.showWaitingBubble(id);
          playDoneSound();
        } else if (status === 'awaitingUser') {
          const since = typeof msg.since === 'number' ? msg.since : Date.now();
          os.showAwaitingUserBubble(id, since);
        } else if (status === 'idle' || status === 'active') {
          os.clearAwaitingUserBubble(id);
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        os.showPermissionBubble(id);
        playPermissionSound();
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        // Show permission bubble on the sub-agent character
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        os.clearPermissionBubble(id);
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        // Update sub-agent character's tool and active state (if already created by
        // agentToolStart via PreToolUse). The lookup uses the REAL parent tool id from
        // JSONL, which won't match the synthetic hook-id the sub-agent was created
        // with -- so this is a best-effort update for the heuristic (JSONL-driven) path.
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) =>
          prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
        );
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} wall tile set(s)`);
        setWallSprites(sets);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
        setSoundEnabledState(soundOn);
        if (typeof msg.watchAllSessions === 'boolean') {
          setWatchAllSessions(msg.watchAllSessions as boolean);
        }
        if (typeof msg.alwaysShowLabels === 'boolean') {
          setAlwaysShowLabels(msg.alwaysShowLabels as boolean);
        }
        setShowTerminalNames(msg.showTerminalNames as boolean);
        if (typeof msg.hooksEnabled === 'boolean') {
          setHooksEnabled(msg.hooksEnabled as boolean);
        }
        if (typeof msg.hooksInfoShown === 'boolean') {
          setHooksInfoShown(msg.hooksInfoShown as boolean);
        }
        if (typeof msg.defaultCwd === 'string') {
          setDefaultCwdState(msg.defaultCwd as string);
        }
        if (Array.isArray(msg.recentAgentFolders)) {
          setRecentAgentFolders(msg.recentAgentFolders as string[]);
        }
        if (typeof msg.terminalFontFamily === 'string') {
          setTerminalFontFamilyState(msg.terminalFontFamily as string);
        }
        if (typeof msg.terminalLineHeight === 'number') {
          setTerminalLineHeightState(msg.terminalLineHeight as number);
        }
        if (Array.isArray(msg.externalAssetDirectories)) {
          setExternalAssetDirectories(msg.externalAssetDirectories as string[]);
        }
        if (typeof msg.lastSeenVersion === 'string') {
          setLastSeenVersion(msg.lastSeenVersion as string);
        }
        if (typeof msg.extensionVersion === 'string') {
          setExtensionVersion(msg.extensionVersion as string);
        }
      } else if (msg.type === 'setDebugMode') {
        onSetDebugMode?.(msg.enabled as boolean);
      } else if (msg.type === 'externalAssetDirectoriesUpdated') {
        if (Array.isArray(msg.dirs)) {
          setExternalAssetDirectories(msg.dirs as string[]);
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      } else if (msg.type === 'agentRenamed') {
        const id = msg.id as number;
        if (typeof msg.customTitle !== 'string') return;
        const customTitle = msg.customTitle;
        const ch = os.characters.get(id);
        if (ch) {
          ch.customTitle = customTitle;
          setAgentRenameSeq((n) => n + 1);
        }
      } else if (msg.type === 'agentTeamInfo') {
        const id = msg.id as number;
        os.setTeamInfo(
          id,
          msg.teamName as string | undefined,
          msg.agentName as string | undefined,
          msg.isTeamLead as boolean | undefined,
          msg.leadAgentId as number | undefined,
          msg.teamUsesTmux as boolean | undefined,
        );
        setAgentRenameSeq((n) => n + 1);
      } else if (msg.type === 'agentTokenUsage') {
        const id = msg.id as number;
        os.setAgentTokens(id, msg.inputTokens as number, msg.outputTokens as number);
      } else if (msg.type === 'ptyData') {
        const id = msg.agentId as number;
        const data = msg.data as string;
        ptyEventBusRef.current.emitData(id, data);
      } else if (msg.type === 'ptyExit') {
        const id = msg.agentId as number;
        const code = msg.code as number;
        const signal = typeof msg.signal === 'string' ? msg.signal : undefined;
        ptyEventBusRef.current.emitExit(id, { code, signal });
      } else if (msg.type === 'ptyScrollback') {
        const id = msg.agentId as number;
        const lines = Array.isArray(msg.lines) ? (msg.lines as string[]) : [];
        ptyEventBusRef.current.emitScrollback(id, lines);
      } else if (msg.type === 'agentCrashed') {
        const agentId = msg.agentId as number;
        const code = typeof msg.code === 'number' ? msg.code : 0;
        const signal = typeof msg.signal === 'string' ? (msg.signal as string) : undefined;
        // Drop if the agent has already been closed in the webview.
        if (!os.characters.has(agentId)) return;
        os.setAgentCrashed(agentId, true);
        setCrashState((prev) =>
          applyCrashAction(prev, { type: 'agentCrashed', agentId, code, signal }),
        );
      } else if (msg.type === 'crashAcknowledged') {
        const agentId = msg.agentId as number;
        os.acknowledgeCrash(agentId);
        setCrashState((prev) => applyCrashAction(prev, { type: 'crashAcknowledged', agentId }));
      } else if (msg.type === 'agentRestarted') {
        const agentId = msg.agentId as number;
        os.setAgentCrashed(agentId, false);
        setCrashState((prev) => applyCrashAction(prev, { type: 'agentRestarted', agentId }));
      } else if (msg.type === 'hookHealthChanged') {
        const status = msg.status as 'ok' | 'degraded' | 'down';
        const reason = typeof msg.reason === 'string' ? (msg.reason as string) : undefined;
        if (status === 'ok' || status === 'degraded' || status === 'down') {
          setHookHealth({ status, reason });
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    showTerminalNames,
    soundEnabled: soundEnabledState,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    defaultCwd,
    setDefaultCwd,
    recentAgentFolders,
    terminalFontFamily,
    terminalLineHeight,
    setTerminalFontFamily,
    setTerminalLineHeight,
    ptyEventBus: ptyEventBusRef.current,
    ptyBackedByAgent,
    agentRenameSeq,
    crashState,
    hookHealth,
    acknowledgeCrash,
    restartAgent,
  };
}
