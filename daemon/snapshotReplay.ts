// daemon/snapshotReplay.ts
import type { MessageSink } from '../src/types.js';

export interface SnapshotDeps {
  sink: MessageSink;
  getCharacterSprites: () => unknown;
  getFloorTiles: () => unknown;
  getWallTiles: () => unknown;
  getFurnitureAssets: () => unknown;
  getExistingAgents: () => Array<{ id: number; sessionId?: string; [k: string]: unknown }>;
  getLayout: () => Record<string, unknown> | null;
  getSettings: () => Record<string, unknown>;
  getHookHealth: () => string | null;
  getRenamedAgents: () => Array<{ id: number; customTitle: string }>;
  getTeamInfo: () => Array<{
    id: number;
    teamName?: string;
    agentName?: string;
    isTeamLead?: boolean;
    leadAgentId?: number;
  }>;
  getTerminalNameChanges: () => Array<{ id: number; terminalName: string }>;
  getActiveAgentStatuses: () => Array<{ id: number; status: string; [k: string]: unknown }>;
}

/** Fire the full snapshot to a sink. Idempotent — safe to call on every WS
 *  connect or reconnect.
 *
 *  Order matters: assets first (so the renderer can paint), then state, then
 *  per-agent replays (which mutate existing characters in place).
 *
 *  1. characterSpritesLoaded, floorTilesLoaded, wallTilesLoaded, furnitureAssetsLoaded
 *  2. existingAgents, layoutLoaded?, settingsLoaded, hookHealthChanged?
 *  3. per-agent agentRenamed, agentTeamInfo, agentTerminalNameChanged, agentStatus
 */
export async function replaySnapshot(deps: SnapshotDeps): Promise<void> {
  // Phase 1: assets (renderer needs them before layoutLoaded paints).
  await deps.sink.postMessage({
    type: 'characterSpritesLoaded',
    sprites: deps.getCharacterSprites(),
  });
  await deps.sink.postMessage({ type: 'floorTilesLoaded', tiles: deps.getFloorTiles() });
  await deps.sink.postMessage({ type: 'wallTilesLoaded', tiles: deps.getWallTiles() });
  await deps.sink.postMessage({ type: 'furnitureAssetsLoaded', assets: deps.getFurnitureAssets() });

  // Phase 2: state.
  await deps.sink.postMessage({ type: 'existingAgents', agents: deps.getExistingAgents() });
  const layout = deps.getLayout();
  if (layout) {
    await deps.sink.postMessage({ type: 'layoutLoaded', layout });
  }
  await deps.sink.postMessage({ type: 'settingsLoaded', settings: deps.getSettings() });
  const health = deps.getHookHealth();
  if (health) {
    await deps.sink.postMessage({ type: 'hookHealthChanged', state: health });
  }

  // Phase 3: per-agent replays.
  for (const a of deps.getRenamedAgents()) {
    await deps.sink.postMessage({ type: 'agentRenamed', id: a.id, customTitle: a.customTitle });
  }
  for (const t of deps.getTeamInfo()) {
    await deps.sink.postMessage({ type: 'agentTeamInfo', ...t });
  }
  for (const n of deps.getTerminalNameChanges()) {
    await deps.sink.postMessage({ type: 'agentTerminalNameChanged', ...n });
  }
  for (const s of deps.getActiveAgentStatuses()) {
    await deps.sink.postMessage({ type: 'agentStatus', ...s });
  }
}
