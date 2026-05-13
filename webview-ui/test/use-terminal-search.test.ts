import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type SearchAction,
  searchReducer,
  type SearchState,
} from '../src/office/panel/useTerminalSearch.ts';

const initial: SearchState = {
  open: false,
  query: '',
  currentMatch: 0,
  totalMatches: 0,
};

function reduce(state: SearchState, ...actions: SearchAction[]): SearchState {
  return actions.reduce(searchReducer, state);
}

test('open transitions from closed to open', () => {
  const next = reduce(initial, { type: 'open' });
  assert.equal(next.open, true);
  assert.equal(next.query, '');
});

test('close resets to initial', () => {
  const opened: SearchState = { open: true, query: 'foo', currentMatch: 2, totalMatches: 5 };
  const next = reduce(opened, { type: 'close' });
  assert.deepEqual(next, initial);
});

test('setQuery updates query string', () => {
  const next = reduce(initial, { type: 'open' }, { type: 'setQuery', query: 'hello' });
  assert.equal(next.query, 'hello');
});

test('setResults updates match counters', () => {
  const next = reduce(
    initial,
    { type: 'open' },
    { type: 'setResults', currentMatch: 3, totalMatches: 12 },
  );
  assert.equal(next.currentMatch, 3);
  assert.equal(next.totalMatches, 12);
});

test('setQuery with empty string zeroes counters', () => {
  const populated: SearchState = { open: true, query: 'foo', currentMatch: 1, totalMatches: 5 };
  const next = reduce(populated, { type: 'setQuery', query: '' });
  assert.equal(next.query, '');
  assert.equal(next.currentMatch, 0);
  assert.equal(next.totalMatches, 0);
});
