import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DRAWER_HEIGHT_MAX_PX,
  DRAWER_HEIGHT_RATIO,
  MIN_DRAWER_VIEWPORT_PX,
  PEEK_HEIGHT_PX,
  RAIL_HEIGHT_PX,
} from '../src/constants.ts';
import { computeBand } from '../src/office/drawer/drawerLayout.ts';
import type { DrawerState } from '../src/office/drawer/drawerTypes.ts';
import { DrawerMode } from '../src/office/drawer/drawerTypes.ts';

function baseState(over: Partial<DrawerState> = {}): DrawerState {
  return {
    drawerOpen: false,
    railHidden: false,
    focusedAgentId: null,
    isEditMode: false,
    viewportHeight: 800,
    ...over,
  };
}

test('computeBand: closed + rail visible → rail band', () => {
  const band = computeBand(baseState({ drawerOpen: false, railHidden: false }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
  assert.equal(band.canvasHeight, 800 - RAIL_HEIGHT_PX);
});

test('computeBand: closed + rail hidden → peek band', () => {
  const band = computeBand(baseState({ drawerOpen: false, railHidden: true }));
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
  assert.equal(band.canvasHeight, 800 - PEEK_HEIGHT_PX);
});

test('computeBand: open + adequate viewport → drawer band', () => {
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: 800 }));
  assert.equal(band.mode, DrawerMode.OPEN);
  const expected = Math.min(Math.round(800 * DRAWER_HEIGHT_RATIO), DRAWER_HEIGHT_MAX_PX);
  assert.equal(band.bandHeight, expected);
  assert.equal(band.canvasHeight, 800 - expected);
});

test('computeBand: open + very tall viewport → band capped at max', () => {
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: 2000 }));
  assert.equal(band.bandHeight, DRAWER_HEIGHT_MAX_PX);
});

test('computeBand: open + viewport under floor → forced to rail', () => {
  const short = MIN_DRAWER_VIEWPORT_PX - 10;
  const band = computeBand(baseState({ drawerOpen: true, viewportHeight: short }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
});

test('computeBand: open + viewport under floor + railHidden → forced to peek', () => {
  const short = MIN_DRAWER_VIEWPORT_PX - 10;
  const band = computeBand(
    baseState({ drawerOpen: true, railHidden: true, viewportHeight: short }),
  );
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
});

test('computeBand: edit mode forces rail regardless of drawerOpen', () => {
  const band = computeBand(baseState({ drawerOpen: true, isEditMode: true }));
  assert.equal(band.mode, DrawerMode.RAIL);
  assert.equal(band.bandHeight, RAIL_HEIGHT_PX);
});

test('computeBand: edit mode + railHidden → peek (respects user hide)', () => {
  const band = computeBand(baseState({ drawerOpen: true, isEditMode: true, railHidden: true }));
  assert.equal(band.mode, DrawerMode.PEEK);
  assert.equal(band.bandHeight, PEEK_HEIGHT_PX);
});

test('computeBand: canvas height never negative', () => {
  const band = computeBand(baseState({ viewportHeight: 0, drawerOpen: false }));
  assert.equal(band.canvasHeight >= 0, true);
});
