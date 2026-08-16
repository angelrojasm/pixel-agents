// CONTRACT: field names below MUST match the parsers in
// webview-ui/src/hooks/useExtensionMessages.ts:
//   characterSpritesLoaded → msg.characters   (~line 536)
//   floorTilesLoaded       → msg.sprites      (~line 544)
//   wallTilesLoaded        → msg.sets         (~line 548)
//   furnitureAssetsLoaded  → msg.catalog + msg.sprites (~line 596)
//   settingsLoaded         → flat msg.soundEnabled etc. (~line 555)
//   existingAgents         → msg.agents:number[] + agentMeta/folderNames/
//                            externalAgents/terminalNames/ptyBackedAgents (~line 291)
//   hookHealthChanged      → msg.status / msg.reason  (~line 661)
//   layoutLoaded           → msg.layout       (~line 191)
// The webview project cannot be imported across the project boundary; this
// comment is the cross-link. If you change either side, change both.
import { describe, expect, it } from 'vitest';

import { replaySnapshot } from '../snapshotReplay';

const REQUIRED_KEYS: Record<string, string[]> = {
  characterSpritesLoaded: ['characters'],
  floorTilesLoaded: ['sprites'],
  wallTilesLoaded: ['sets'],
  furnitureAssetsLoaded: ['catalog', 'sprites'],
  existingAgents: [
    'agents',
    'agentMeta',
    'folderNames',
    'externalAgents',
    'terminalNames',
    'ptyBackedAgents',
  ],
  layoutLoaded: ['layout'],
  settingsLoaded: ['soundEnabled'],
  hookHealthChanged: ['status'],
};
const FORBIDDEN_KEYS: Record<string, string[]> = {
  characterSpritesLoaded: ['sprites'],
  floorTilesLoaded: ['tiles'],
  wallTilesLoaded: ['tiles'],
  furnitureAssetsLoaded: ['assets'],
  existingAgents: [],
  settingsLoaded: ['settings'],
  hookHealthChanged: ['state'],
};

function deps(sink: { postMessage(m: unknown): Promise<void> }) {
  return {
    sink,
    getCharacterSprites: () => [['x']],
    getFloorTiles: () => [['x']],
    getWallTiles: () => [[['x']]],
    getFurnitureAssets: () => ({ catalog: [{ id: 'DESK' }], sprites: { DESK: [['x']] } }),
    getExistingAgentsPayload: () => ({
      agents: [1],
      agentMeta: { 1: { palette: 0, hueShift: 0 } },
      folderNames: {},
      externalAgents: {},
      terminalNames: {},
      ptyBackedAgents: { 1: true },
    }),
    getLayout: () => ({ version: 1, tiles: [] }) as Record<string, unknown> | null,
    getSettings: () => ({ soundEnabled: true, alwaysShowLabels: false }),
    getHookHealth: () =>
      ({ status: 'ok', since: 5 }) as { status: string; reason?: string; since?: number } | null,
    getRenamedAgents: () => [{ id: 1, customTitle: 'T' }],
    getTeamInfo: () => [],
    getTerminalNameChanges: () => [],
    getActiveAgentStatuses: () => [{ id: 1, status: 'active' }],
  };
}

describe('snapshotReplay message contract', () => {
  it('emits webview-parseable shapes in documented order', async () => {
    const messages: Array<Record<string, unknown>> = [];
    await replaySnapshot(
      deps({ postMessage: async (m) => void messages.push(m as Record<string, unknown>) }),
    );
    const types = messages.map((m) => m.type);
    expect(types.slice(0, 8)).toEqual([
      'characterSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'furnitureAssetsLoaded',
      'existingAgents',
      'layoutLoaded',
      'settingsLoaded',
      'hookHealthChanged',
    ]);
    for (const m of messages) {
      const t = m.type as string;
      for (const k of REQUIRED_KEYS[t] ?? []) expect(m, `${t} needs ${k}`).toHaveProperty(k);
      for (const k of FORBIDDEN_KEYS[t] ?? [])
        expect(k in m, `${t} must not have ${k}`).toBe(false);
    }
    const existing = messages.find((m) => m.type === 'existingAgents')!;
    expect((existing.agents as unknown[]).every((id) => typeof id === 'number')).toBe(true);
  });

  it('skips layoutLoaded when getLayout returns null (fallback lives in the caller)', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const d = deps({ postMessage: async (m) => void messages.push(m as Record<string, unknown>) });
    d.getLayout = () => null;
    await replaySnapshot(d);
    expect(messages.map((m) => m.type)).not.toContain('layoutLoaded');
  });
});
