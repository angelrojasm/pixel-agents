import { describe, expect, it } from 'vitest';

import { resolveBundledAssetPath } from '../assetLoader.js';

describe('resolveBundledAssetPath', () => {
  it('resolves relative to the running module, not vscode workspace', () => {
    const p = resolveBundledAssetPath('floors.png');
    expect(p).toMatch(/[/\\]assets[/\\]floors\.png$/);
    expect(p).not.toMatch(/vscode/i);
  });
});
