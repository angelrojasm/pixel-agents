import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSavedLayout, isValidLayout, rememberSavedLayout } from '../src/office/layoutFile.ts';

test('isValidLayout accepts version-1 layouts with tiles', () => {
  assert.equal(isValidLayout({ version: 1, tiles: [] }), true);
  assert.equal(isValidLayout({ version: 2, tiles: [] }), false);
  assert.equal(isValidLayout({ version: 1 }), false);
  assert.equal(isValidLayout(null), false);
  assert.equal(isValidLayout('nope'), false);
});

test('rememberSavedLayout stores the raw payload verbatim', () => {
  const raw = { version: 1, tiles: [0] };
  rememberSavedLayout(raw);
  // Same reference — export must serialize the saved state, never a migrated copy.
  assert.equal(getSavedLayout(), raw);
});

test('getSavedLayout returns the most recent remembered layout', () => {
  const first = { version: 1, tiles: [1] };
  const second = { version: 1, tiles: [2] };
  rememberSavedLayout(first);
  rememberSavedLayout(second);
  assert.equal(getSavedLayout(), second);
});
