/**
 * PTY-driven animation (Task 5 of the m1.5 character-behaviors slice).
 * Covers the pure throttle/deadline helper behind useCharacterPtyActivity,
 * and getCharacterSprite's TYPE-state branch ordering: inactive → static
 * pose, tool outranks pty, pty window → typing, silence → reading.
 *
 * Run with: npm run test:webview -- test/pty-activity.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { PTY_ACTIVITY_HOLD_MS, PTY_ACTIVITY_THROTTLE_MS } from '../src/constants.js';
import { createCharacter, getCharacterSprite } from '../src/office/engine/characters.js';
import { nextActivityBump } from '../src/office/panel/useCharacterPtyActivity.js';
import type { CharacterSprites } from '../src/office/sprites/spriteData.js';
import { setProviderCapabilities } from '../src/office/toolUtils.js';
import type { Character, SpriteData } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

describe('nextActivityBump', () => {
  it('first bump returns now + hold', () => {
    expect(nextActivityBump(0, 1000)).toBe(1000 + PTY_ACTIVITY_HOLD_MS);
  });

  it('bumps inside the throttle window return null', () => {
    expect(nextActivityBump(1000, 1000 + PTY_ACTIVITY_THROTTLE_MS - 1)).toBeNull();
  });

  it('bumps at or past the throttle window return a new deadline', () => {
    expect(nextActivityBump(1000, 1000 + PTY_ACTIVITY_THROTTLE_MS)).toBe(
      1000 + PTY_ACTIVITY_THROTTLE_MS + PTY_ACTIVITY_HOLD_MS,
    );
  });
});

// ── getCharacterSprite: TYPE-state pty branch ──────────────────────────────

/** Distinct 1x1 SpriteData token, unique per (kind, direction, frame). */
function sd(token: string): SpriteData {
  return [[token]];
}

function makeSprites(): CharacterSprites {
  const dirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT];
  const walk = {} as Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>;
  const typing = {} as Record<Direction, [SpriteData, SpriteData]>;
  const reading = {} as Record<Direction, [SpriteData, SpriteData]>;
  for (const dir of dirs) {
    walk[dir] = [
      sd(`walk-${dir}-0`),
      sd(`walk-${dir}-1`),
      sd(`walk-${dir}-2`),
      sd(`walk-${dir}-3`),
    ];
    typing[dir] = [sd(`typing-${dir}-0`), sd(`typing-${dir}-1`)];
    reading[dir] = [sd(`reading-${dir}-0`), sd(`reading-${dir}-1`)];
  }
  return { walk, typing, reading };
}

describe('getCharacterSprite — TYPE state pty branch', () => {
  const sprites = makeSprites();

  beforeAll(() => {
    // 'Read' classified as a reading tool so the "tool outranks pty" case can
    // prove ordering: a reading tool with an open pty window must still win
    // (a pty-first bug would otherwise return the typing sprite here).
    setProviderCapabilities({ readingTools: ['Read'], subagentToolNames: [] });
  });

  function makeChar(overrides: Partial<Character>): Character {
    const ch = createCharacter(1, 0, null, null);
    ch.state = CharacterState.TYPE;
    return Object.assign(ch, overrides);
  }

  it('inactive → static pose (walk frame 1), regardless of tool/pty', () => {
    const ch = makeChar({
      isActive: false,
      currentTool: null,
      ptyActivityUntil: Date.now() + 10_000,
    });
    expect(getCharacterSprite(ch, sprites)).toBe(sprites.walk[ch.dir][1]);
  });

  it('tool outranks pty: reading tool wins even with an open pty window', () => {
    const ch = makeChar({
      isActive: true,
      currentTool: 'Read',
      ptyActivityUntil: Date.now() + 10_000,
    });
    expect(getCharacterSprite(ch, sprites)).toBe(sprites.reading[ch.dir][ch.frame % 2]);
  });

  it('no tool, pty window open → typing', () => {
    const ch = makeChar({
      isActive: true,
      currentTool: null,
      ptyActivityUntil: Date.now() + 10_000,
    });
    expect(getCharacterSprite(ch, sprites)).toBe(sprites.typing[ch.dir][ch.frame % 2]);
  });

  it('no tool, pty window elapsed (silence) → reading', () => {
    const ch = makeChar({
      isActive: true,
      currentTool: null,
      ptyActivityUntil: 0,
    });
    expect(getCharacterSprite(ch, sprites)).toBe(sprites.reading[ch.dir][ch.frame % 2]);
  });
});
