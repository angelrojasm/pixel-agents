import { describe, expect, it } from 'vitest';

import {
  isPtyInputMessage,
  isPtyResizeMessage,
  isTerminalPaneReadyMessage,
} from '../ptyProtocol.js';

describe('ptyProtocol guards', () => {
  it('isPtyInputMessage recognises valid input', () => {
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1, data: 'x' })).toBe(true);
  });

  it('isPtyInputMessage rejects wrong type, missing fields, wrong field types', () => {
    expect(isPtyInputMessage({ type: 'other', agentId: 1, data: 'x' })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1 })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: '1', data: 'x' })).toBe(false);
    expect(isPtyInputMessage({ type: 'ptyInput', agentId: 1, data: 5 })).toBe(false);
    expect(isPtyInputMessage(null)).toBe(false);
    expect(isPtyInputMessage('ptyInput')).toBe(false);
  });

  it('isPtyResizeMessage recognises valid resize', () => {
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 80, rows: 24 })).toBe(true);
  });

  it('isPtyResizeMessage rejects non-positive dimensions', () => {
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 0, rows: 24 })).toBe(false);
    expect(isPtyResizeMessage({ type: 'ptyResize', agentId: 2, cols: 80, rows: -1 })).toBe(false);
  });

  it('isTerminalPaneReadyMessage recognises valid ready signal', () => {
    expect(isTerminalPaneReadyMessage({ type: 'terminalPaneReady', agentId: 3 })).toBe(true);
    expect(isTerminalPaneReadyMessage({ type: 'terminalPaneReady' })).toBe(false);
    expect(isTerminalPaneReadyMessage({ type: 'other', agentId: 3 })).toBe(false);
  });
});
