import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agentManager.js', async (orig) => ({
  ...(await orig<typeof import('../../src/agentManager.js')>()),
  launchNewTerminal: vi.fn(async () => {}),
  restartPty: vi.fn(() => true),
}));
vi.mock('../../src/layoutPersistence.js', async (orig) => ({
  ...(await orig<typeof import('../../src/layoutPersistence.js')>()),
  writeLayoutToFile: vi.fn(),
}));
vi.mock('../../src/configPersistence.js', () => {
  const cfg = { externalAssetDirectories: ['/existing'] };
  return {
    readConfig: vi.fn(() => ({
      ...cfg,
      externalAssetDirectories: [...cfg.externalAssetDirectories],
    })),
    writeConfig: vi.fn(),
  };
});

import { launchNewTerminal, restartPty } from '../../src/agentManager.js';
import { writeConfig } from '../../src/configPersistence.js';
import { writeLayoutToFile } from '../../src/layoutPersistence.js';
import type { AgentState } from '../../src/types.js';
import type { Orchestrator } from '../orchestrator.js';
import type { DispatchContext, HostActions } from '../uiDispatch.js';
import { createUiDispatch } from '../uiDispatch.js';

function agent(partial: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 's',
    projectDir: '/p',
    jsonlFile: '/p/s.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    palette: 0,
    hueShift: 0,
    ...partial,
  } as AgentState;
}

interface Recorded {
  calls: string[];
}

function makeOrchestratorStub(rec: Recorded): Orchestrator {
  return {
    nextAgentId: { current: 1 },
    nextTerminalIndex: { current: 1 },
    activeAgentId: { current: null },
    knownJsonlFiles: new Set<string>(),
    fileWatchers: new Map(),
    pollingTimers: new Map(),
    waitingTimers: new Map(),
    permissionTimers: new Map(),
    jsonlPollTimers: new Map(),
    projectScanTimer: { current: null },
    ptyManager: null,
    registerAgentHook: (a: AgentState) => rec.calls.push(`registerAgentHook:${a.id}`),
    dismissAwaitingUser: (id: number) => rec.calls.push(`dismissAwaitingUser:${id}`),
    closeExternalOrPtyAgent: (id: number) => rec.calls.push(`closeExternalOrPtyAgent:${id}`),
    saveAgentSeats: () => rec.calls.push('saveAgentSeats'),
    markLayoutWrite: () => rec.calls.push('markLayoutWrite'),
    setHooksEnabled: (enabled: boolean, extensionPath?: string) =>
      rec.calls.push(`setHooksEnabled:${enabled}:${extensionPath ?? 'none'}`),
    handleSettingsMessage: (type: string) => {
      rec.calls.push(`handleSettingsMessage:${type}`);
      return 'handled' as const;
    },
    restoreCategoryDefaults: () => rec.calls.push('restoreCategoryDefaults'),
    broadcastSettingsLoaded: () => rec.calls.push('broadcastSettingsLoaded'),
    reloadAndSendCharacters: async () => void rec.calls.push('reloadAndSendCharacters'),
    reloadAndSendFurniture: async () => void rec.calls.push('reloadAndSendFurniture'),
  } as unknown as Orchestrator;
}

function makeHostActions(rec: Recorded): HostActions {
  return {
    focusTerminal: (a, lead) => rec.calls.push(`focusTerminal:${a.id}:${lead?.id ?? 'none'}`),
    disposeTerminal: (a) => rec.calls.push(`disposeTerminal:${a.id}`),
    exportLayout: async () => void rec.calls.push('exportLayout'),
    importLayoutViaDialog: async () => void rec.calls.push('importLayoutViaDialog'),
    openExternal: (uri) => rec.calls.push(`openExternal:${uri}`),
    openSessionsFolder: () => rec.calls.push('openSessionsFolder'),
    pickExternalAssetDirectory: async () => '/picked',
    getBypassPermissions: () => {
      rec.calls.push('getBypassPermissions');
      return true;
    },
    onAgentsLaunched: (newAgents) =>
      rec.calls.push(`onAgentsLaunched:${newAgents.map((a) => a.id).join(',')}`),
    onWebviewReady: async (ctx) =>
      void rec.calls.push(`onWebviewReady:ws=${ctx.isWsClient === true}`),
  };
}

describe('createUiDispatch routing', () => {
  let rec: Recorded;
  let agents: Map<number, AgentState>;
  let broadcast: Array<Record<string, unknown>>;
  let reply: Array<Record<string, unknown>>;
  let hostActions: HostActions;
  let dispatch: ReturnType<typeof createUiDispatch>;
  let ctx: DispatchContext;

  beforeEach(() => {
    vi.clearAllMocks();
    rec = { calls: [] };
    agents = new Map();
    broadcast = [];
    reply = [];
    hostActions = makeHostActions(rec);
    dispatch = createUiDispatch({
      orchestrator: makeOrchestratorStub(rec),
      agents,
      broadcastSink: {
        postMessage: async (m) => void broadcast.push(m as Record<string, unknown>),
      },
      config: { get: () => undefined, update: () => {}, snapshot: () => ({}) } as never,
      persistAgents: () => rec.calls.push('persistAgents'),
      hookScriptSourcePath: '/ext/path',
      hostActions,
    });
    ctx = {
      replySink: { postMessage: async (m) => void reply.push(m as Record<string, unknown>) },
    };
  });

  it('openClaude launches, registers new agents, and calls onAgentsLaunched', async () => {
    vi.mocked(launchNewTerminal).mockImplementationOnce(async (...args: unknown[]) => {
      const map = args[2] as Map<number, AgentState>;
      map.set(7, agent({ id: 7 }));
    });
    await dispatch.handle({ type: 'openClaude' }, ctx);
    expect(rec.calls).toContain('registerAgentHook:7');
    expect(rec.calls).toContain('onAgentsLaunched:7');
  });

  it('focusAgent routes to hostActions.focusTerminal with lead fallback', async () => {
    agents.set(3, agent({ id: 3, leadAgentId: 1 }));
    agents.set(1, agent({ id: 1 }));
    await dispatch.handle({ type: 'focusAgent', id: 3 }, ctx);
    expect(rec.calls).toContain('focusTerminal:3:1');
  });

  it('closeAgent: ptyBacked goes to closeExternalOrPtyAgent', async () => {
    agents.set(4, agent({ id: 4, ptyBacked: true }));
    await dispatch.handle({ type: 'closeAgent', id: 4 }, ctx);
    expect(rec.calls).toContain('closeExternalOrPtyAgent:4');
  });

  it('closeAgent: terminalRef goes to hostActions.disposeTerminal', async () => {
    agents.set(
      5,
      agent({ id: 5, terminalRef: { name: 't', show: () => {}, dispose: () => {} } as never }),
    );
    await dispatch.handle({ type: 'closeAgent', id: 5 }, ctx);
    expect(rec.calls).toContain('disposeTerminal:5');
    expect(rec.calls).not.toContain('closeExternalOrPtyAgent:5');
  });

  it('closeAgent: external (no terminal, no pty) goes to closeExternalOrPtyAgent', async () => {
    agents.set(6, agent({ id: 6, isExternal: true }));
    await dispatch.handle({ type: 'closeAgent', id: 6 }, ctx);
    expect(rec.calls).toContain('closeExternalOrPtyAgent:6');
  });

  it('saveLayout marks own write, persists, and broadcasts layoutLoaded to all clients', async () => {
    const layout = { version: 1, tiles: [] };
    await dispatch.handle({ type: 'saveLayout', layout }, ctx);
    expect(rec.calls).toContain('markLayoutWrite');
    expect(vi.mocked(writeLayoutToFile)).toHaveBeenCalledWith(layout);
    expect(broadcast).toContainEqual({ type: 'layoutLoaded', layout });
  });

  it('saveAgentSeats routes to orchestrator', async () => {
    await dispatch.handle({ type: 'saveAgentSeats', seats: {} }, ctx);
    expect(rec.calls).toContain('saveAgentSeats');
  });

  it('dismissAwaitingUser routes to orchestrator', async () => {
    await dispatch.handle({ type: 'dismissAwaitingUser', id: 9 }, ctx);
    expect(rec.calls).toContain('dismissAwaitingUser:9');
  });

  it('setHooksEnabled forwards deps.hookScriptSourcePath', async () => {
    await dispatch.handle({ type: 'setHooksEnabled', enabled: true }, ctx);
    expect(rec.calls).toContain('setHooksEnabled:true:/ext/path');
  });

  it('setWatchAllSessions goes through o.handleSettingsMessage', async () => {
    await dispatch.handle({ type: 'setWatchAllSessions', enabled: false }, ctx);
    expect(rec.calls).toContain('handleSettingsMessage:setWatchAllSessions');
  });

  it('restoreCategoryDefaults routes and rebroadcasts settings', async () => {
    await dispatch.handle({ type: 'restoreCategoryDefaults', category: 'general' }, ctx);
    expect(rec.calls).toContain('restoreCategoryDefaults');
    expect(rec.calls).toContain('broadcastSettingsLoaded');
  });

  it('requestDiagnostics posts agentDiagnostics to ctx.replySink, not broadcast', async () => {
    agents.set(1, agent({ id: 1 }));
    await dispatch.handle({ type: 'requestDiagnostics' }, ctx);
    expect(reply.some((m) => m.type === 'agentDiagnostics')).toBe(true);
    expect(broadcast.some((m) => m.type === 'agentDiagnostics')).toBe(false);
  });

  it('webviewReady calls hostActions.onWebviewReady with ctx (incl. isWsClient)', async () => {
    await dispatch.handle({ type: 'webviewReady' }, { ...ctx, isWsClient: true });
    expect(rec.calls).toContain('onWebviewReady:ws=true');
  });

  it('exportLayout routes to hostActions', async () => {
    await dispatch.handle({ type: 'exportLayout' }, ctx);
    expect(rec.calls).toContain('exportLayout');
  });

  it('openSessionsFolder routes to hostActions', async () => {
    await dispatch.handle({ type: 'openSessionsFolder' }, ctx);
    expect(rec.calls).toContain('openSessionsFolder');
  });

  it('importLayout with valid inline layout writes file + broadcasts layoutLoaded', async () => {
    const layout = { version: 1, tiles: [0] };
    await dispatch.handle({ type: 'importLayout', layout }, ctx);
    expect(rec.calls).toContain('markLayoutWrite');
    expect(vi.mocked(writeLayoutToFile)).toHaveBeenCalledWith(layout);
    expect(broadcast).toContainEqual({ type: 'layoutLoaded', layout });
    expect(rec.calls).not.toContain('importLayoutViaDialog');
  });

  it('importLayout with bad inline payload (version !== 1) writes nothing', async () => {
    await dispatch.handle({ type: 'importLayout', layout: { version: 2, tiles: [] } }, ctx);
    expect(vi.mocked(writeLayoutToFile)).not.toHaveBeenCalled();
    expect(broadcast).toHaveLength(0);
  });

  it('importLayout without payload goes to hostActions.importLayoutViaDialog', async () => {
    await dispatch.handle({ type: 'importLayout' }, ctx);
    expect(rec.calls).toContain('importLayoutViaDialog');
  });

  it('openExternal reads message.uri', async () => {
    await dispatch.handle({ type: 'openExternal', uri: 'https://x.test' }, ctx);
    expect(rec.calls).toContain('openExternal:https://x.test');
  });

  it('acknowledgeCrash broadcasts crashAcknowledged', async () => {
    await dispatch.handle({ type: 'acknowledgeCrash', agentId: 2 }, ctx);
    expect(broadcast).toContainEqual({ type: 'crashAcknowledged', agentId: 2 });
  });

  it('restartAgent uses getBypassPermissions and broadcasts agentRestarted on success', async () => {
    await dispatch.handle({ type: 'restartAgent', agentId: 2 }, ctx);
    expect(rec.calls).toContain('getBypassPermissions');
    expect(vi.mocked(restartPty)).toHaveBeenCalled();
    expect(broadcast).toContainEqual({ type: 'agentRestarted', agentId: 2 });
  });

  it('addExternalAssetDirectory adds the picked path and rebroadcasts dirs', async () => {
    await dispatch.handle({ type: 'addExternalAssetDirectory' }, ctx);
    expect(vi.mocked(writeConfig)).toHaveBeenCalled();
    expect(rec.calls).toContain('reloadAndSendCharacters');
    const update = broadcast.find((m) => m.type === 'externalAssetDirectoriesUpdated');
    expect(update?.dirs).toEqual(['/existing', '/picked']);
  });

  it('addExternalAssetDirectory: null pick is a no-op', async () => {
    hostActions.pickExternalAssetDirectory = async () => null;
    await dispatch.handle({ type: 'addExternalAssetDirectory' }, ctx);
    expect(vi.mocked(writeConfig)).not.toHaveBeenCalled();
    expect(broadcast).toHaveLength(0);
  });

  it('removeExternalAssetDirectory filters config and rebroadcasts dirs', async () => {
    await dispatch.handle({ type: 'removeExternalAssetDirectory', path: '/existing' }, ctx);
    expect(vi.mocked(writeConfig)).toHaveBeenCalled();
    const update = broadcast.find((m) => m.type === 'externalAssetDirectoriesUpdated');
    expect(update?.dirs).toEqual([]);
  });

  it('unknown set* falls through to o.handleSettingsMessage', async () => {
    await dispatch.handle({ type: 'setSoundEnabled', enabled: false }, ctx);
    expect(rec.calls).toContain('handleSettingsMessage:setSoundEnabled');
  });
});
