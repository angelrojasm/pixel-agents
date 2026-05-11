import assert from 'node:assert/strict';
import { test } from 'node:test';

import { facesComputer } from '../src/office/engine/seatAdjacency.ts';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.ts';
import { layoutToSeats } from '../src/office/layout/layoutSerializer.ts';
import { Direction } from '../src/office/types.ts';

test('facesComputer: chair faces a directly-adjacent computer', () => {
  const electronicsTiles = new Set<string>(['5,6']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, true);
});

test('facesComputer: chair faces empty tiles', () => {
  const electronicsTiles = new Set<string>();
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: chair faces AWAY from computer', () => {
  const electronicsTiles = new Set<string>(['5,6']);
  const result = facesComputer(5, 5, Direction.UP, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: computer within side offset (wide desk)', () => {
  const electronicsTiles = new Set<string>(['6,6']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, true);
});

test('facesComputer: computer beyond facing depth', () => {
  const electronicsTiles = new Set<string>(['5,9']);
  const result = facesComputer(5, 5, Direction.DOWN, electronicsTiles);
  assert.equal(result, false);
});

test('facesComputer: horizontal facing checks vertical neighbors', () => {
  const electronicsTiles = new Set<string>(['6,4']);
  const result = facesComputer(5, 5, Direction.RIGHT, electronicsTiles);
  assert.equal(result, true);
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

test('layoutToSeats: chair facing computer on desk is a work seat', () => {
  installTestCatalog();
  const seats = layoutToSeats([
    { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
    { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
    { uid: 'monitor-1', type: 'MONITOR', col: 5, row: 6 },
  ]);
  const seat = seats.get('chair-1');
  assert.ok(seat);
  assert.equal(seat.role, 'work');
});

test('layoutToSeats: chair facing bare desk (no computer) is a rest seat', () => {
  installTestCatalog();
  const seats = layoutToSeats([
    { uid: 'chair-1', type: 'CHAIR_FRONT', col: 5, row: 5 },
    { uid: 'desk-1', type: 'DESK', col: 5, row: 6 },
  ]);
  const seat = seats.get('chair-1');
  assert.ok(seat);
  assert.equal(seat.role, 'rest');
});

test('layoutToSeats: standalone couch produces only rest seats', () => {
  installTestCatalog();
  const seats = layoutToSeats([{ uid: 'couch-1', type: 'COUCH', col: 3, row: 3 }]);
  const a = seats.get('couch-1');
  const b = seats.get('couch-1:1');
  assert.ok(a && b);
  assert.equal(a.role, 'rest');
  assert.equal(b.role, 'rest');
});
