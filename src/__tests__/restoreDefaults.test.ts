import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../constants.js';
// We'll import the handler indirectly via the provider's message handler.
// For this unit test, we extract just the resolution logic into a helper
// called `resolveCategoryDefaults` exported from PixelAgentsViewProvider
// (via settingsDefaults.ts — a vscode-free helper file).
import { resolveCategoryDefaults } from '../settingsDefaults.js';

describe('resolveCategoryDefaults', () => {
  it('returns DEFAULT_SETTINGS slice when no override given', () => {
    const r = resolveCategoryDefaults('general', undefined);
    expect(r).toEqual(DEFAULT_SETTINGS.general);
  });

  it('returns the override when given (for undo)', () => {
    const snapshot = {
      ...DEFAULT_SETTINGS.general,
      soundEnabled: false,
    } as unknown as (typeof DEFAULT_SETTINGS)['general'];
    const r = resolveCategoryDefaults('general', snapshot);
    expect(r).toEqual(snapshot);
  });

  it('throws on unknown category', () => {
    expect(() => resolveCategoryDefaults('bogus' as never, undefined)).toThrow();
  });
});
