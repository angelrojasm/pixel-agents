/**
 * Unit tests for `getFocusHaloStyle` (Task 10 of the m1.5 character-behaviors
 * slice): the pure selector that picks the focus halo's color/dash/width for
 * a single character. Ported from v2-orchestrator's
 * `webview-ui/test/character-halo.test.ts` (node:test → Vitest).
 *
 * Priority order (first match wins):
 *   1. focused + awaiting  → AWAITING, solid
 *   2. active  + focused   → ACCENT,   solid
 *   3. active  + unfocused → MUTED,    solid
 *   4. focused + idle      → ACCENT,   dotted
 *   5. otherwise           → null (no halo)
 *
 * Run with: npm run test:webview -- test/character-halo.test.ts
 */
import { describe, expect, it } from 'vitest';

import {
  FOCUS_HALO_COLOR_ACCENT,
  FOCUS_HALO_COLOR_AWAITING,
  FOCUS_HALO_COLOR_MUTED,
  FOCUS_HALO_DOTTED_DASH,
  FOCUS_HALO_SOLID_DASH,
} from '../src/constants.js';
import { getFocusHaloStyle } from '../src/office/engine/characterHalo.js';

interface HaloInput {
  isActive: boolean;
  isFocused: boolean;
  awaitingSince: number | null;
}

function input(overrides: Partial<HaloInput>): HaloInput {
  return { isActive: false, isFocused: false, awaitingSince: null, ...overrides };
}

describe('getFocusHaloStyle', () => {
  it('idle + not focused → no halo', () => {
    expect(getFocusHaloStyle(input({}))).toBeNull();
  });

  it('idle + focused → dotted accent halo', () => {
    const style = getFocusHaloStyle(input({ isFocused: true }));
    expect(style).not.toBeNull();
    expect(style!.dash).toEqual(FOCUS_HALO_DOTTED_DASH);
    expect(style!.color).toBe(FOCUS_HALO_COLOR_ACCENT);
  });

  it('active + focused → solid accent halo', () => {
    const style = getFocusHaloStyle(input({ isActive: true, isFocused: true }));
    expect(style!.dash).toEqual(FOCUS_HALO_SOLID_DASH);
    expect(style!.color).toBe(FOCUS_HALO_COLOR_ACCENT);
  });

  it('active + NOT focused → solid muted halo', () => {
    const style = getFocusHaloStyle(input({ isActive: true, isFocused: false }));
    expect(style!.dash).toEqual(FOCUS_HALO_SOLID_DASH);
    expect(style!.color).toBe(FOCUS_HALO_COLOR_MUTED);
  });

  it('awaiting user + focused → solid amber halo', () => {
    const style = getFocusHaloStyle(input({ isFocused: true, awaitingSince: Date.now() }));
    expect(style!.color).toBe(FOCUS_HALO_COLOR_AWAITING);
    expect(style!.dash).toEqual(FOCUS_HALO_SOLID_DASH);
  });
});
