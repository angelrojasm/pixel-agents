import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_COLOR_WARNING,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
} from '../src/constants.ts';
import { getFocusHaloStyle } from '../src/office/engine/characterHalo.ts';

interface HaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
  ptyStubFocused?: boolean;
}

function input(overrides: Partial<HaloInput>): HaloInput {
  return { isActive: false, isFocused: false, awaitingSince: null, ...overrides };
}

test('idle + not focused → no halo', () => {
  assert.equal(getFocusHaloStyle(input({})), null);
});

test('idle + focused → dotted accent halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true }));
  assert.notEqual(style, null);
  assert.deepEqual(style!.dash, FOCUS_HALO_DOTTED_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_ACCENT);
});

test('active + focused → solid accent halo', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: true }));
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_ACCENT);
});

test('active + NOT focused → solid muted halo', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: false }));
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
  assert.equal(style!.color, FOCUS_HALO_COLOR_MUTED);
});

test('awaiting user + focused → solid amber halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true, awaitingSince: Date.now() }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_AWAITING);
  assert.deepEqual(style!.dash, FOCUS_HALO_SOLID_DASH);
});

test('pty stub + focused → solid warning halo', () => {
  const style = getFocusHaloStyle(input({ isFocused: true, ptyStubFocused: true }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_WARNING);
});

test('pty stub overrides accent priority', () => {
  const style = getFocusHaloStyle(input({ isActive: true, isFocused: true, ptyStubFocused: true }));
  assert.equal(style!.color, FOCUS_HALO_COLOR_WARNING);
});
