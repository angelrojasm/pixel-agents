import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PTY_ACTIVITY_HOLD_MS } from '../src/constants.ts';
import {
  ptyActivityInitialState,
  ptyActivityReducer,
  type PtyActivityState,
} from '../src/office/panel/ptyActivityReducer.ts';

test('initial state has 0 lastActivityAt + 0 ptyActivityUntil', () => {
  assert.deepEqual(ptyActivityInitialState, { lastActivityAt: 0, ptyActivityUntil: 0 });
});

test('activity bump sets ptyActivityUntil = now + HOLD_MS', () => {
  const now = 1_000;
  const next = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now });
  assert.equal(next.lastActivityAt, now);
  assert.equal(next.ptyActivityUntil, now + PTY_ACTIVITY_HOLD_MS);
});

test('activity bump within HOLD_MS extends the deadline', () => {
  const s1 = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now: 1_000 });
  const s2 = ptyActivityReducer(s1, { type: 'bump', now: 1_100 });
  assert.equal(s2.ptyActivityUntil, 1_100 + PTY_ACTIVITY_HOLD_MS);
});

test('reset returns to initial state', () => {
  const s1 = ptyActivityReducer(ptyActivityInitialState, { type: 'bump', now: 1_000 });
  const s2 = ptyActivityReducer(s1, { type: 'reset' });
  assert.deepEqual(s2, ptyActivityInitialState);
});

test('bump preserves monotonicity of lastActivityAt', () => {
  const s1: PtyActivityState = { lastActivityAt: 2_000, ptyActivityUntil: 2_000 + 200 };
  const s2 = ptyActivityReducer(s1, { type: 'bump', now: 1_500 });
  assert.equal(s2.lastActivityAt, 2_000, 'older bump cannot rewind lastActivityAt');
  assert.equal(s2.ptyActivityUntil, 2_000 + 200, 'deadline preserved');
});
