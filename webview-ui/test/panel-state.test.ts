import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  closeAgent,
  focusOrToggle,
  setEditMode,
  setPanelPosition,
  setTerminalFontSize,
  setViewportHeight,
  toggleRailHidden,
} from '../src/office/panel/panelState.ts';
import type { PanelState } from '../src/office/panel/panelTypes.ts';
import { PanelPosition } from '../src/office/panel/panelTypes.ts';

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

test('focusOrToggle: first focus opens panel and sets focused id', () => {
  const next = focusOrToggle(baseState(), 5);
  assert.equal(next.panelOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('focusOrToggle: clicking focused agent again collapses panel', () => {
  const open = baseState({ panelOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 5);
  assert.equal(next.panelOpen, false);
  assert.equal(next.focusedAgentId, 5);
});

test('focusOrToggle: clicking a different agent switches focus, keeps panel open', () => {
  const open = baseState({ panelOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 7);
  assert.equal(next.panelOpen, true);
  assert.equal(next.focusedAgentId, 7);
});

test('focusOrToggle: clicking focused agent when panel already closed re-opens', () => {
  const closed = baseState({ panelOpen: false, focusedAgentId: 5 });
  const next = focusOrToggle(closed, 5);
  assert.equal(next.panelOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('closeAgent: removes focus if closed agent was focused', () => {
  const state = baseState({ panelOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, 3);
  assert.equal(next.focusedAgentId, 3);
  assert.equal(next.panelOpen, true);
});

test('closeAgent: when no other agent remains, collapses panel', () => {
  const state = baseState({ panelOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, null);
  assert.equal(next.focusedAgentId, null);
  assert.equal(next.panelOpen, false);
});

test('closeAgent: unrelated id close leaves state untouched', () => {
  const state = baseState({ panelOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 7, 3);
  assert.deepEqual(next, state);
});

test('toggleRailHidden: flips railHidden boolean', () => {
  const a = toggleRailHidden(baseState({ railHidden: false }));
  assert.equal(a.railHidden, true);
  const b = toggleRailHidden(a);
  assert.equal(b.railHidden, false);
});

test('setEditMode: setting to true does not mutate panelOpen (override is visual)', () => {
  const state = baseState({ panelOpen: true });
  const next = setEditMode(state, true);
  assert.equal(next.isEditMode, true);
  assert.equal(next.panelOpen, true);
});

test('setEditMode: exiting edit mode leaves panelOpen intact', () => {
  const state = baseState({ panelOpen: true, isEditMode: true });
  const next = setEditMode(state, false);
  assert.equal(next.isEditMode, false);
  assert.equal(next.panelOpen, true);
});

test('setViewportHeight: shrinking below floor does not mutate panelOpen', () => {
  const state = baseState({ panelOpen: true, viewportHeight: 800 });
  const next = setViewportHeight(state, 200);
  assert.equal(next.viewportHeight, 200);
  assert.equal(next.panelOpen, true);
});

test('setPanelPosition: switching position is reflected in state', () => {
  const next = setPanelPosition(baseState(), PanelPosition.LEFT);
  assert.equal(next.panelPosition, PanelPosition.LEFT);
});

test('setPanelPosition: same position returns the same object (no change)', () => {
  const s = baseState({ panelPosition: PanelPosition.LEFT });
  const next = setPanelPosition(s, PanelPosition.LEFT);
  assert.strictEqual(next, s);
});

test('setTerminalFontSize: clamps to allowed range', () => {
  const tooSmall = setTerminalFontSize(baseState(), 5);
  assert.equal(tooSmall.terminalFontSize, 10);
  const tooBig = setTerminalFontSize(baseState(), 100);
  assert.equal(tooBig.terminalFontSize, 24);
  const ok = setTerminalFontSize(baseState(), 16);
  assert.equal(ok.terminalFontSize, 16);
});

test('setTerminalFontSize: rounds non-integers', () => {
  const next = setTerminalFontSize(baseState(), 14.6);
  assert.equal(next.terminalFontSize, 15);
});
