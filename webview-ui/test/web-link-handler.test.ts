import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleWebLinkClick } from '../src/office/panel/webLinkHandler.ts';

// Node 24 does not expose MouseEvent as a global. Provide a minimal shim so
// the tests can construct event objects; handleWebLinkClick ignores the event.
if (typeof globalThis.MouseEvent === 'undefined') {
  // @ts-expect-error — intentional polyfill for the test environment
  globalThis.MouseEvent = class MouseEvent {
    readonly type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

test('handleWebLinkClick posts an openExternal message via the vscode shim', () => {
  const posted: unknown[] = [];
  const fakeVscode = {
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: <T>(s: T) => s,
  };

  handleWebLinkClick(new MouseEvent('click'), 'https://example.com/', {
    vscode: fakeVscode,
    isBrowserRuntime: false,
  });

  assert.deepEqual(posted, [{ type: 'openExternal', uri: 'https://example.com/' }]);
});

test('handleWebLinkClick falls back to window.open in browser runtime', () => {
  const opened: Array<[string, string]> = [];
  const fakeWindowOpen = ((url: string, target: string) => {
    opened.push([url, target]);
    return null;
  }) as typeof window.open;
  const posted: unknown[] = [];
  const fakeVscode = {
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: <T>(s: T) => s,
  };

  handleWebLinkClick(new MouseEvent('click'), 'https://example.com/', {
    vscode: fakeVscode,
    isBrowserRuntime: true,
    windowOpen: fakeWindowOpen,
  });

  assert.deepEqual(opened, [['https://example.com/', '_blank']]);
  assert.deepEqual(posted, []);
});
