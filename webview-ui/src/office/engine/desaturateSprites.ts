import { adjustSprite } from '../colorize.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { SpriteData } from '../types.js';
import { Direction as Dir } from '../types.js';

/** Cut saturation by `percent` (0..100). Operates on a single SpriteData; uses
 *  the existing `adjustSprite` HSL pipeline via a negative `s` shift. */
export function desaturateSpriteData(sprite: SpriteData, percent: number): SpriteData {
  if (percent <= 0) return sprite;
  // adjustSprite's `s` is a -100..100 shift; -percent gives a saturation cut.
  return adjustSprite(sprite, { h: 0, s: -percent, b: 0, c: 0 });
}

/** Apply desaturation to every frame in a CharacterSprites set. */
export function desaturateCharacterSprites(
  sprites: CharacterSprites,
  percent: number,
): CharacterSprites {
  if (percent <= 0) return sprites;
  const cut = (s: SpriteData) => desaturateSpriteData(s, percent);
  const cutWalk = (
    arr: [SpriteData, SpriteData, SpriteData, SpriteData],
  ): [SpriteData, SpriteData, SpriteData, SpriteData] => [
    cut(arr[0]),
    cut(arr[1]),
    cut(arr[2]),
    cut(arr[3]),
  ];
  const cutPair = (arr: [SpriteData, SpriteData]): [SpriteData, SpriteData] => [
    cut(arr[0]),
    cut(arr[1]),
  ];
  return {
    walk: {
      [Dir.DOWN]: cutWalk(sprites.walk[Dir.DOWN]),
      [Dir.UP]: cutWalk(sprites.walk[Dir.UP]),
      [Dir.RIGHT]: cutWalk(sprites.walk[Dir.RIGHT]),
      [Dir.LEFT]: cutWalk(sprites.walk[Dir.LEFT]),
    },
    typing: {
      [Dir.DOWN]: cutPair(sprites.typing[Dir.DOWN]),
      [Dir.UP]: cutPair(sprites.typing[Dir.UP]),
      [Dir.RIGHT]: cutPair(sprites.typing[Dir.RIGHT]),
      [Dir.LEFT]: cutPair(sprites.typing[Dir.LEFT]),
    },
    reading: {
      [Dir.DOWN]: cutPair(sprites.reading[Dir.DOWN]),
      [Dir.UP]: cutPair(sprites.reading[Dir.UP]),
      [Dir.RIGHT]: cutPair(sprites.reading[Dir.RIGHT]),
      [Dir.LEFT]: cutPair(sprites.reading[Dir.LEFT]),
    },
  };
}
