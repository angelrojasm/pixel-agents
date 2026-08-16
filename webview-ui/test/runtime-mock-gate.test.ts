import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldUseBrowserMock } from '../src/runtime.ts';

// Under the node test runner acquireVsCodeApi is undefined, so
// isBrowserRuntime is true — both branches below exercise the real flag.
const doc = (hasToken: boolean) =>
  ({
    querySelector: (sel: string) => (hasToken && sel === 'meta[name="px-token"]' ? {} : null),
  }) as unknown as Pick<Document, 'querySelector'>;

test('mock runs on vite-dev pages (no px-token meta)', () => {
  assert.equal(shouldUseBrowserMock(doc(false)), true);
});

test('mock is skipped on daemon-served pages (px-token present)', () => {
  assert.equal(shouldUseBrowserMock(doc(true)), false);
});
