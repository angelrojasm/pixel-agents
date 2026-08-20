/**
 * Ported from v2 (git show v2-orchestrator:webview-ui/test/seat-classification.test.ts),
 * converted from node:test to Vitest. Covers the facesComputer adjacency window and
 * the work/rest role classification layoutToSeats derives from it.
 */
import { describe, expect, it } from 'vitest';

import { collectElectronicsTiles, facesComputer } from '../src/office/engine/seatAdjacency.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { layoutToSeats } from '../src/office/layout/layoutSerializer.js';
import { Direction } from '../src/office/types.js';

describe('facesComputer', () => {
  it('sees an electronics tile straight ahead within depth', () => {
    expect(facesComputer(5, 5, Direction.DOWN, new Set(['5,6']))).toBe(true);
  });

  it('sees a side-offset tile at any depth (wide desk)', () => {
    expect(facesComputer(5, 5, Direction.DOWN, new Set(['6,7']))).toBe(true);
  });

  it('rejects beyond AUTO_ON_FACING_DEPTH', () => {
    expect(facesComputer(5, 5, Direction.DOWN, new Set(['5,9']))).toBe(false);
  });

  it('rejects tiles behind the facing direction', () => {
    expect(facesComputer(5, 5, Direction.UP, new Set(['5,6']))).toBe(false);
  });

  it('rejects when there are no electronics tiles at all', () => {
    expect(facesComputer(5, 5, Direction.DOWN, new Set())).toBe(false);
  });

  it('checks vertical neighbors when facing horizontally', () => {
    expect(facesComputer(5, 5, Direction.RIGHT, new Set(['6,4']))).toBe(true);
  });
});

/** Install a minimal in-memory catalog for layoutToSeats tests. */
function installTestCatalog() {
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const tinySprite = [['#000000']];
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const wideSprite = [['#000000', '#000000']];
  buildDynamicCatalog({
    catalog: [
      {
        id: 'DESK',
        label: 'Desk',
        category: 'desks',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: true,
      },
      {
        id: 'MONITOR',
        label: 'Monitor',
        category: 'electronics',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        canPlaceOnSurfaces: true,
      },
      {
        id: 'CHAIR_FRONT',
        label: 'Chair',
        category: 'chairs',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        orientation: 'front',
      },
      {
        id: 'COUCH',
        label: 'Couch',
        category: 'chairs',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        isDesk: false,
        orientation: 'front',
      },
    ],
    sprites: {
      DESK: tinySprite,
      MONITOR: tinySprite,
      CHAIR_FRONT: tinySprite,
      COUCH: wideSprite,
    },
  });
}

describe('collectElectronicsTiles', () => {
  it('collects every footprint tile of electronics furniture, skipping other categories', () => {
    installTestCatalog();
    const tiles = collectElectronicsTiles([
      { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
      { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
      { uid: 'monitor-1', type: 'MONITOR', col: 5, row: 6 },
    ]);
    expect(tiles).toEqual(new Set(['5,6']));
  });

  it('returns an empty set when no electronics furniture is present', () => {
    installTestCatalog();
    const tiles = collectElectronicsTiles([
      { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
      { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
    ]);
    expect(tiles).toEqual(new Set());
  });
});

describe('layoutToSeats roles', () => {
  it('chair facing a monitor on a desk → work', () => {
    installTestCatalog();
    const seats = layoutToSeats([
      { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
      { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
      { uid: 'monitor-1', type: 'MONITOR', col: 5, row: 6 },
    ]);
    const seat = seats.get('chair-1');
    expect(seat).toBeDefined();
    expect(seat?.role).toBe('work');
  });

  it('chair facing a bare desk (no computer) → rest', () => {
    installTestCatalog();
    const seats = layoutToSeats([
      { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
      { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
    ]);
    const seat = seats.get('chair-1');
    expect(seat).toBeDefined();
    expect(seat?.role).toBe('rest');
  });

  it('2-wide couch → two rest seats uid and uid:1', () => {
    installTestCatalog();
    const seats = layoutToSeats([{ uid: 'couch-1', type: 'COUCH', col: 3, row: 3 }]);
    const a = seats.get('couch-1');
    const b = seats.get('couch-1:1');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.role).toBe('rest');
    expect(b?.role).toBe('rest');
  });
});
