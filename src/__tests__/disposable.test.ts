import { describe, expect, it, vi } from 'vitest';

import type { Disposable } from '../disposable.js';

describe('Disposable', () => {
  it('invokes dispose() exactly once on a registered consumer', () => {
    const cleanup = vi.fn();
    const d: Disposable = { dispose: cleanup };
    d.dispose();
    d.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('accepts a vscode.Disposable-shaped value structurally (no runtime conversion needed)', () => {
    // simulates what was passed by vscode APIs: an object whose dispose() returns undefined
    const vscodeShaped = { dispose: () => undefined };
    const d: Disposable = vscodeShaped;
    expect(d.dispose()).toBeUndefined();
  });
});
