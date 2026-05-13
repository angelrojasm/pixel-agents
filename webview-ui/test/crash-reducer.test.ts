import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyCrashAction, crashInitialState, type CrashState } from '../src/hooks/crashReducer.ts';

test('initial state has empty crashedAgents', () => {
  assert.deepEqual(crashInitialState, { crashedAgents: {} });
});

test('agentCrashed sets crashedAgents[id] = { code, signal }', () => {
  const next = applyCrashAction(crashInitialState, {
    type: 'agentCrashed',
    agentId: 5,
    code: 1,
    signal: undefined,
  });
  assert.deepEqual(next.crashedAgents, { 5: { code: 1, signal: null } });
});

test('agentCrashed with signal stores the signal string', () => {
  const next = applyCrashAction(crashInitialState, {
    type: 'agentCrashed',
    agentId: 5,
    code: 0,
    signal: 'SIGTERM',
  });
  assert.deepEqual(next.crashedAgents, { 5: { code: 0, signal: 'SIGTERM' } });
});

test('crashAcknowledged is a no-op on the reducer (renderer reads ack state)', () => {
  const prev: CrashState = { crashedAgents: { 5: { code: 1, signal: null } } };
  const next = applyCrashAction(prev, { type: 'crashAcknowledged', agentId: 5 });
  // Reducer keeps crash record so re-renders are consistent; the renderer reads
  // ch.crashedAcknowledged for the glyph, and acknowledgement happens directly
  // on the character mutation, not in this slice.
  assert.deepEqual(next, prev);
});

test('agentRestarted clears the crashed record for that agent', () => {
  const prev: CrashState = {
    crashedAgents: { 5: { code: 1, signal: null }, 7: { code: 2, signal: null } },
  };
  const next = applyCrashAction(prev, { type: 'agentRestarted', agentId: 5 });
  assert.deepEqual(next.crashedAgents, { 7: { code: 2, signal: null } });
});

test('agentClosed clears the crashed record for that agent', () => {
  const prev: CrashState = { crashedAgents: { 5: { code: 1, signal: null } } };
  const next = applyCrashAction(prev, { type: 'agentClosed', agentId: 5 });
  assert.deepEqual(next.crashedAgents, {});
});
