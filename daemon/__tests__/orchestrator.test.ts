import * as fs from 'node:fs';
import * as path from 'node:path';
import * as realOs from 'node:os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Isolated HOME — never let orchestrator persistence touch the real ~/.pixel-agents.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('os')>('node:os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});

const { createOrchestrator } = await import('../orchestrator.js');
const { createConfigStore } = await import('../configStore.js');
const { setHostBridge, daemonHostBridge } = await import('../../src/hostBridge.js');
const { getProjectDirPath } = await import('../../src/agentManager.js');

import type { PixelAgentsServer } from '../../server/src/server.js';
import type { AgentState } from '../../src/types.js';

function stubServer(): PixelAgentsServer {
  return {
    onHookEvent: () => {},
    onHealthChange: () => {},
    getHealthState: () => null,
    getBroadcastSink: () => ({ postMessage: async () => true }),
  } as unknown as PixelAgentsServer;
}

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

describe('orchestrator', () => {
  let sinkMessages: unknown[];

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-orch-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
    sinkMessages = [];
  });

  afterEach(() => {
    setHostBridge(daemonHostBridge);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function makeOrchestrator() {
    return createOrchestrator({
      broadcastSink: { postMessage: async (m: unknown) => void sinkMessages.push(m) },
      server: stubServer(),
      config: createConfigStore(path.join(tmpHome, '.pixel-agents', 'config.json')),
      agentsFilePath: path.join(tmpHome, '.pixel-agents', 'agents.json'),
      assetsRoot: null,
      extensionVersion: '',
    });
  }

  it('setWatchAllSessions(false) keeps externals inside the host workspace', () => {
    const workspacePath = '/ws/proj';
    setHostBridge({ ...daemonHostBridge, workspaceFolders: () => [workspacePath] });
    const o = makeOrchestrator();
    const agents = o.agents as Map<number, AgentState>;
    const insideDir = getProjectDirPath(workspacePath);
    agents.set(1, agent({ id: 1, isExternal: true, projectDir: insideDir }));
    agents.set(2, agent({ id: 2, isExternal: true, projectDir: '/foreign/dir' }));

    o.handleSettingsMessage('setWatchAllSessions', { enabled: false });

    expect(agents.has(1)).toBe(true);
    expect(agents.has(2)).toBe(false);
    o.dispose();
  });

  it('setWatchAllSessions(false) with empty workspace prunes all externals (daemon)', () => {
    const o = makeOrchestrator();
    const agents = o.agents as Map<number, AgentState>;
    agents.set(1, agent({ id: 1, isExternal: true, projectDir: '/a' }));
    agents.set(2, agent({ id: 2, isExternal: true, projectDir: '/b' }));

    o.handleSettingsMessage('setWatchAllSessions', { enabled: false });

    expect([...agents.values()].some((a) => a.isExternal)).toBe(false);
    o.dispose();
  });

  it('ensurePtyManager returns a disposable per source', () => {
    const o = makeOrchestrator();
    const sub = o.ensurePtyManager({ onMessage: () => ({ dispose: () => {} }) });
    expect(typeof sub.dispose).toBe('function');
    o.dispose();
  });

  it('persistNow writes agents.json', () => {
    const o = makeOrchestrator();
    o.persistNow();
    expect(fs.existsSync(path.join(tmpHome, '.pixel-agents', 'agents.json'))).toBe(true);
    o.dispose();
  });
});
