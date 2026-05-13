import assert from 'node:assert/strict';
import { test } from 'node:test';

import { desaturateSpriteData } from '../src/office/engine/desaturateSprites.ts';

test('desaturateSpriteData zeroes empty pixels untouched', () => {
  const sprite = [
    // eslint-disable-next-line pixel-agents/no-inline-colors
    ['', '#ff0000', ''],
    ['', '', ''],
  ];
  const out = desaturateSpriteData(sprite, 60);
  assert.equal(out[0][0], '');
  assert.equal(out[0][2], '');
  assert.equal(out[1][1], '');
});

test('desaturateSpriteData cuts saturation by the given percentage', () => {
  // Pure red (#ff0000) is HSL(0, 100%, 50%). 60% cut → 40% saturation.
  // Approx RGB at HSL(0, 40%, 50%) ≈ (179, 77, 77) i.e. #b34d4d.
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 60);
  const px = out[0][0];
  assert.equal(px.length, 7, `expected 7-char hex, got ${px}`);
  const r = parseInt(px.slice(1, 3), 16);
  const g = parseInt(px.slice(3, 5), 16);
  const b = parseInt(px.slice(5, 7), 16);
  assert.ok(r > g + 50, 'red still dominant');
  assert.ok(g > 50 && g < 120, 'green between mid range');
  assert.ok(Math.abs(g - b) < 10, 'green ≈ blue');
});

test('desaturateSpriteData preserves alpha suffix on 9-char hex', () => {
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const sprite = [['#ff000080']];
  const out = desaturateSpriteData(sprite, 60);
  assert.equal(out[0][0].length, 9);
  assert.equal(out[0][0].slice(7), '80');
});

test('desaturateSpriteData with 0% is a passthrough', () => {
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 0);
  // eslint-disable-next-line pixel-agents/no-inline-colors
  assert.equal(out[0][0].toLowerCase(), '#ff0000');
});

test('desaturateSpriteData with 100% pushes to grayscale', () => {
  // eslint-disable-next-line pixel-agents/no-inline-colors
  const sprite = [['#ff0000']];
  const out = desaturateSpriteData(sprite, 100);
  const px = out[0][0];
  const r = parseInt(px.slice(1, 3), 16);
  const g = parseInt(px.slice(3, 5), 16);
  const b = parseInt(px.slice(5, 7), 16);
  assert.ok(Math.abs(r - g) < 3 && Math.abs(g - b) < 3, 'all channels equal at full desat');
});
