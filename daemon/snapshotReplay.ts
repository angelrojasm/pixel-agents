// daemon/snapshotReplay.ts
import type { MessageSink } from '../src/types.js';

// Output field names are CONTRACT-BOUND to the webview parsers in
// webview-ui/src/hooks/useExtensionMessages.ts — see
// daemon/__tests__/snapshotReplay.contract.test.ts before changing any shape.
export interface SnapshotDeps {
  sink: MessageSink;
  /** Sent as `{ characters }`. */
  getCharacterSprites: () => unknown;
  /** Sent as `{ sprites }`. */
  getFloorTiles: () => unknown;
  /** Sent as `{ sets }`. */
  getWallTiles: () => unknown;
  /** Spread into the message: `{ catalog, sprites }`. */
  getFurnitureAssets: () => { catalog: unknown; sprites?: unknown };
  /** Spread into the message — build with agentManager.buildExistingAgentsPayload. */
  getExistingAgentsPayload: () => Record<string, unknown>;
  getLayout: () => Record<string, unknown> | null;
  /** Spread FLAT into settingsLoaded (webview reads msg.soundEnabled etc.). */
  getSettings: () => Record<string, unknown>;
  /** Spread into hookHealthChanged as `{ status, reason, since }`. */
  getHookHealth: () => { status: string; reason?: string; since?: number } | null;
  getRenamedAgents: () => Array<{ id: number; customTitle: string }>;
  getTeamInfo: () => Array<{
    id: number;
    teamName?: string;
    agentName?: string;
    isTeamLead?: boolean;
    leadAgentId?: number;
    teamUsesTmux?: boolean;
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
    characters: deps.getCharacterSprites(),
  });
  await deps.sink.postMessage({ type: 'floorTilesLoaded', sprites: deps.getFloorTiles() });
  await deps.sink.postMessage({ type: 'wallTilesLoaded', sets: deps.getWallTiles() });
  await deps.sink.postMessage({ type: 'furnitureAssetsLoaded', ...deps.getFurnitureAssets() });

  // Phase 2: state.
  await deps.sink.postMessage({ type: 'existingAgents', ...deps.getExistingAgentsPayload() });
  const layout = deps.getLayout();
  if (layout) {
    await deps.sink.postMessage({ type: 'layoutLoaded', layout });
  }
  await deps.sink.postMessage({ type: 'settingsLoaded', ...deps.getSettings() });
  const health = deps.getHookHealth();
  if (health) {
    await deps.sink.postMessage({ type: 'hookHealthChanged', ...health });
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
