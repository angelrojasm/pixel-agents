import { describe, expect, it } from 'vitest';

import { toPtyEvent } from '../src/hooks/ptyEvents.js';

describe('toPtyEvent', () => {
  it('maps ptyData', () => {
    expect(toPtyEvent({ type: 'ptyData', id: 1, data: 'x' })).toEqual({
      kind: 'data',
      id: 1,
      data: 'x',
    });
  });

  it('maps ptyExit', () => {
    expect(toPtyEvent({ type: 'ptyExit', id: 2, code: 0, signal: 'SIGTERM' })).toEqual({
      kind: 'exit',
      id: 2,
      code: 0,
      signal: 'SIGTERM',
    });
  });

  it('maps ptyScrollback', () => {
    expect(toPtyEvent({ type: 'ptyScrollback', id: 3, lines: ['a', 'b'] })).toEqual({
      kind: 'scrollback',
      id: 3,
      lines: ['a', 'b'],
    });
  });

  it('maps agentCrashed', () => {
    expect(toPtyEvent({ type: 'agentCrashed', id: 4, code: 137, signal: 'SIGKILL' })).toEqual({
      kind: 'crashed',
      id: 4,
      code: 137,
      signal: 'SIGKILL',
    });
  });

  it('maps agentRestarted', () => {
    expect(toPtyEvent({ type: 'agentRestarted', id: 5 })).toEqual({ kind: 'restarted', id: 5 });
  });

  it('returns null for unrelated messages', () => {
    expect(toPtyEvent({ type: 'agentStatus', id: 1 })).toBeNull();
    expect(toPtyEvent({ type: 'layoutLoaded' })).toBeNull();
  });

  it('returns null when id is missing or not a number', () => {
    expect(toPtyEvent({ type: 'ptyData', data: 'x' })).toBeNull();
    expect(toPtyEvent({ type: 'ptyData', id: 'nope', data: 'x' })).toBeNull();
  });

  // Watch-list: crashAcknowledged is handled in the MAIN message chain
  // (os.acknowledgeCrash), not the pty fast-path. Anything claimed here
  // short-circuits before the main chain ever sees it — pinned so a future
  // addition to KIND_BY_TYPE doesn't silently swallow this message.
  it('crashAcknowledged is not a pty event', () => {
    expect(toPtyEvent({ type: 'crashAcknowledged', id: 1 })).toBeNull();
  });
});
