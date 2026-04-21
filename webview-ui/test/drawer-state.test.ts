import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  closeAgent,
  focusOrToggle,
  setEditMode,
  setViewportHeight,
  toggleRailHidden,
} from '../src/office/drawer/drawerState.ts';
import type { DrawerState } from '../src/office/drawer/drawerTypes.ts';

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

test('focusOrToggle: first focus opens drawer and sets focused id', () => {
  const next = focusOrToggle(baseState(), 5);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('focusOrToggle: clicking focused agent again collapses drawer', () => {
  const open = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 5);
  assert.equal(next.drawerOpen, false);
  assert.equal(next.focusedAgentId, 5); // keep id; used for re-open
});

test('focusOrToggle: clicking a different agent switches focus, keeps drawer open', () => {
  const open = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = focusOrToggle(open, 7);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 7);
});

test('focusOrToggle: clicking focused agent when drawer already closed re-opens', () => {
  const closed = baseState({ drawerOpen: false, focusedAgentId: 5 });
  const next = focusOrToggle(closed, 5);
  assert.equal(next.drawerOpen, true);
  assert.equal(next.focusedAgentId, 5);
});

test('closeAgent: removes focus if closed agent was focused', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, /* mostRecentOther */ 3);
  assert.equal(next.focusedAgentId, 3);
  assert.equal(next.drawerOpen, true);
});

test('closeAgent: when no other agent remains, collapses drawer', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 5, null);
  assert.equal(next.focusedAgentId, null);
  assert.equal(next.drawerOpen, false);
});

test('closeAgent: unrelated id close leaves state untouched', () => {
  const state = baseState({ drawerOpen: true, focusedAgentId: 5 });
  const next = closeAgent(state, 7, 3);
  assert.deepEqual(next, state);
});

test('toggleRailHidden: flips railHidden boolean', () => {
  const a = toggleRailHidden(baseState({ railHidden: false }));
  assert.equal(a.railHidden, true);
  const b = toggleRailHidden(a);
  assert.equal(b.railHidden, false);
});

test('setEditMode: setting to true does not mutate drawerOpen (override is visual)', () => {
  const state = baseState({ drawerOpen: true });
  const next = setEditMode(state, true);
  assert.equal(next.isEditMode, true);
  assert.equal(next.drawerOpen, true);
});

test('setEditMode: exiting edit mode leaves drawerOpen intact', () => {
  const state = baseState({ drawerOpen: true, isEditMode: true });
  const next = setEditMode(state, false);
  assert.equal(next.isEditMode, false);
  assert.equal(next.drawerOpen, true);
});

test('setViewportHeight: shrinking below floor does not mutate drawerOpen', () => {
  const state = baseState({ drawerOpen: true, viewportHeight: 800 });
  const next = setViewportHeight(state, 200);
  assert.equal(next.viewportHeight, 200);
  assert.equal(next.drawerOpen, true); // computeBand handles the override
});
