import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIN_PANEL_VIEWPORT_PX_HORIZONTAL,
  MIN_PANEL_VIEWPORT_PX_VERTICAL,
  PANEL_BOTTOM_OPEN_MAX_PX,
  PANEL_BOTTOM_OPEN_RATIO,
  PANEL_BOTTOM_PEEK_PX,
  PANEL_BOTTOM_RAIL_PX,
  PANEL_SIDE_OPEN_MAX_PX,
  PANEL_SIDE_OPEN_RATIO,
  PANEL_SIDE_PEEK_PX,
  PANEL_SIDE_RAIL_PX,
} from '../src/constants.ts';
import { computePanelBand } from '../src/office/panel/panelLayout.ts';
import type { PanelState } from '../src/office/panel/panelTypes.ts';
import { PanelMode, PanelPosition } from '../src/office/panel/panelTypes.ts';

function baseState(over: Partial<PanelState> = {}): PanelState {
  return {
    panelOpen: false,
    railHidden: false,
    panelPosition: PanelPosition.BOTTOM,
    terminalFontSize: 14,
    focusedAgentId: null,
    isEditMode: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    ...over,
  };
}

test('bottom: closed + rail visible → bottom rail; canvas fills width', () => {
  const b = computePanelBand(baseState());
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_BOTTOM_RAIL_PX);
  assert.equal(b.canvasW, 1280);
  assert.equal(b.canvasH, 800 - PANEL_BOTTOM_RAIL_PX);
});

test('bottom: closed + rail hidden → bottom peek', () => {
  const b = computePanelBand(baseState({ railHidden: true }));
  assert.equal(b.mode, PanelMode.PEEK);
  assert.equal(b.bandSize, PANEL_BOTTOM_PEEK_PX);
});

test('bottom: open + adequate viewport → drawer band height', () => {
  const b = computePanelBand(baseState({ panelOpen: true }));
  assert.equal(b.mode, PanelMode.OPEN);
  const expected = Math.min(Math.round(800 * PANEL_BOTTOM_OPEN_RATIO), PANEL_BOTTOM_OPEN_MAX_PX);
  assert.equal(b.bandSize, expected);
  assert.equal(b.canvasW, 1280);
  assert.equal(b.canvasH, 800 - expected);
});

test('bottom: open + tall viewport caps at MAX', () => {
  const b = computePanelBand(baseState({ panelOpen: true, viewportHeight: 2000 }));
  assert.equal(b.bandSize, PANEL_BOTTOM_OPEN_MAX_PX);
});

test('bottom: open + height under floor → forced to rail', () => {
  const short = MIN_PANEL_VIEWPORT_PX_VERTICAL - 10;
  const b = computePanelBand(baseState({ panelOpen: true, viewportHeight: short }));
  assert.equal(b.mode, PanelMode.RAIL);
});

test('left: closed + rail visible → side rail; canvas loses width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT }));
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasW, 1280 - PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasH, 800);
});

test('right: closed + rail visible → side rail; canvas loses width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.RIGHT }));
  assert.equal(b.mode, PanelMode.RAIL);
  assert.equal(b.bandSize, PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasW, 1280 - PANEL_SIDE_RAIL_PX);
  assert.equal(b.canvasH, 800);
});

test('left: closed + rail hidden → side peek', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT, railHidden: true }));
  assert.equal(b.mode, PanelMode.PEEK);
  assert.equal(b.bandSize, PANEL_SIDE_PEEK_PX);
});

test('left: open + adequate viewport → side band width', () => {
  const b = computePanelBand(baseState({ panelPosition: PanelPosition.LEFT, panelOpen: true }));
  assert.equal(b.mode, PanelMode.OPEN);
  const expected = Math.min(Math.round(1280 * PANEL_SIDE_OPEN_RATIO), PANEL_SIDE_OPEN_MAX_PX);
  assert.equal(b.bandSize, expected);
  assert.equal(b.canvasW, 1280 - expected);
  assert.equal(b.canvasH, 800);
});

test('right: open + wide viewport caps at side MAX', () => {
  const b = computePanelBand(
    baseState({ panelPosition: PanelPosition.RIGHT, panelOpen: true, viewportWidth: 4000 }),
  );
  assert.equal(b.bandSize, PANEL_SIDE_OPEN_MAX_PX);
});

test('left: open + width under horizontal floor → forced to rail', () => {
  const narrow = MIN_PANEL_VIEWPORT_PX_HORIZONTAL - 10;
  const b = computePanelBand(
    baseState({ panelPosition: PanelPosition.LEFT, panelOpen: true, viewportWidth: narrow }),
  );
  assert.equal(b.mode, PanelMode.RAIL);
});

test('left: open + width under floor + railHidden → forced to peek', () => {
  const narrow = MIN_PANEL_VIEWPORT_PX_HORIZONTAL - 10;
  const b = computePanelBand(
    baseState({
      panelPosition: PanelPosition.LEFT,
      panelOpen: true,
      railHidden: true,
      viewportWidth: narrow,
    }),
  );
  assert.equal(b.mode, PanelMode.PEEK);
});

test('edit mode forces rail regardless of panelOpen, in any position', () => {
  for (const p of [PanelPosition.BOTTOM, PanelPosition.LEFT, PanelPosition.RIGHT]) {
    const b = computePanelBand(baseState({ panelPosition: p, panelOpen: true, isEditMode: true }));
    assert.equal(b.mode, PanelMode.RAIL, `position ${p}`);
  }
});

test('canvas dimensions never negative', () => {
  const b = computePanelBand(baseState({ viewportWidth: 0, viewportHeight: 0 }));
  assert.equal(b.canvasW >= 0, true);
  assert.equal(b.canvasH >= 0, true);
});
