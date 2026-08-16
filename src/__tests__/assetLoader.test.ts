import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadWallTiles,
} from '../assetLoader.js';

// The source asset tree doubles as a fixture: <root>/assets/{characters,floors,walls}.
// This is the same shape both hosts pass (extension: <ext>/dist, daemon: distRoot).
const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'webview-ui', 'public');

describe('bundled asset loaders honor the assetsRoot parameter', () => {
  it('loadCharacterSprites finds the pre-colored PNGs under assetsRoot', async () => {
    const result = await loadCharacterSprites(FIXTURE_ROOT);
    expect(result).not.toBeNull();
    expect(result!.characters.length).toBeGreaterThanOrEqual(6);
  });

  it('loadFloorTiles finds floor_N.png under assetsRoot', async () => {
    const result = await loadFloorTiles(FIXTURE_ROOT);
    expect(result).not.toBeNull();
    expect(result!.sprites.length).toBeGreaterThan(0);
  });

  it('loadWallTiles finds wall_N.png under assetsRoot', async () => {
    const result = await loadWallTiles(FIXTURE_ROOT);
    expect(result).not.toBeNull();
    expect(result!.sets.length).toBeGreaterThan(0);
  });

  it('loadDefaultLayout finds the bundled default layout under assetsRoot', () => {
    const layout = loadDefaultLayout(FIXTURE_ROOT);
    expect(layout).not.toBeNull();
    expect(layout!.version).toBe(1);
  });

  it('all loaders return null for a root with no assets (never throw)', async () => {
    const empty = path.join(FIXTURE_ROOT, 'no-such-dir');
    expect(await loadCharacterSprites(empty)).toBeNull();
    expect(await loadFloorTiles(empty)).toBeNull();
    expect(await loadWallTiles(empty)).toBeNull();
    expect(loadDefaultLayout(empty)).toBeNull();
  });
});
