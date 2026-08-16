// daemon/__tests__/snapshotReplay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { replaySnapshot, type SnapshotDeps } from '../snapshotReplay.js';

function makeDeps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    sink: { postMessage: vi.fn().mockResolvedValue(true) },
    getCharacterSprites: () => [{ palette: 0 }],
    getFloorTiles: () => [{ pattern: 0 }],
    getWallTiles: () => [{ bitmask: 0 }],
    getFurnitureAssets: () => ({ catalog: [] }),
    getExistingAgentsPayload: () => ({
      agents: [1],
      agentMeta: { 1: { palette: 0, hueShift: 0 } },
      folderNames: {},
      externalAgents: {},
      terminalNames: {},
      ptyBackedAgents: {},
    }),
    getLayout: () => ({ version: 1, cols: 20, rows: 11, tiles: [], furniture: [] }),
    getSettings: () => ({ soundEnabled: true, watchAllSessions: false }),
    getHookHealth: () => ({ status: 'ok' }),
    getRenamedAgents: () => [],
    getTeamInfo: () => [],
    getActiveAgentStatuses: () => [],
    getTerminalNameChanges: () => [],
    ...over,
  };
}

describe('replaySnapshot', () => {
  it('emits assets first, then state, in the documented load order', async () => {
    const post = vi.fn().mockResolvedValue(true);
    await replaySnapshot(makeDeps({ sink: { postMessage: post } }));
    const types = post.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toEqual([
      'characterSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'furnitureAssetsLoaded',
      'existingAgents',
      'layoutLoaded',
      'settingsLoaded',
      'hookHealthChanged',
    ]);
  });

  it('forwards payloads verbatim (not just types)', async () => {
    const post = vi.fn().mockResolvedValue(true);
    const settings = { soundEnabled: false, watchAllSessions: true, defaultCwd: '~' };
    await replaySnapshot(makeDeps({ sink: { postMessage: post }, getSettings: () => settings }));
    const call = post.mock.calls.find((c) => (c[0] as { type: string }).type === 'settingsLoaded');
    expect(call?.[0]).toEqual({ type: 'settingsLoaded', ...settings });
  });

  it('skips layoutLoaded when getLayout returns null', async () => {
    const post = vi.fn().mockResolvedValue(true);
    await replaySnapshot(makeDeps({ sink: { postMessage: post }, getLayout: () => null }));
    const types = post.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).not.toContain('layoutLoaded');
  });

  it('skips hookHealthChanged when health is null (boot grace window)', async () => {
    const post = vi.fn().mockResolvedValue(true);
    await replaySnapshot(makeDeps({ sink: { postMessage: post }, getHookHealth: () => null }));
    const types = post.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).not.toContain('hookHealthChanged');
  });

  it('emits agentRenamed + agentTeamInfo + agentTerminalNameChanged + agentStatus per agent', async () => {
    const post = vi.fn().mockResolvedValue(true);
    await replaySnapshot(
      makeDeps({
        sink: { postMessage: post },
        getRenamedAgents: () => [
          { id: 1, customTitle: 'Lead' },
          { id: 2, customTitle: 'Helper' },
        ],
        getTeamInfo: () => [{ id: 1, teamName: 'A', isTeamLead: true }],
        getTerminalNameChanges: () => [{ id: 1, terminalName: 'shell-1' }],
        getActiveAgentStatuses: () => [{ id: 1, status: 'waiting' }],
      }),
    );
    const types = post.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types.filter((t) => t === 'agentRenamed')).toHaveLength(2);
    expect(types.filter((t) => t === 'agentTeamInfo')).toHaveLength(1);
    expect(types.filter((t) => t === 'agentTerminalNameChanged')).toHaveLength(1);
    expect(types.filter((t) => t === 'agentStatus')).toHaveLength(1);
  });
});
