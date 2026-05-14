import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stepperNext, stepperPrev } from '../src/components/settings/controls/stepperUtils.ts';

// Note: Select / RadioGroup / PathInput / ListEditor are purely presentational
// (no extractable pure logic) — covered by manual QA + the e2e settings flow.

test('stepperNext respects max', () => {
  assert.equal(stepperNext(1.0, 0.1, 0.8, 2.0), 1.1);
  assert.equal(stepperNext(2.0, 0.1, 0.8, 2.0), 2.0);
});

test('stepperNext rounds to step precision', () => {
  // 1.0 + 0.1 in JS is 1.1; verify no float drift after several steps.
  let v = 1.0;
  for (let i = 0; i < 5; i++) v = stepperNext(v, 0.1, 0.8, 2.0);
  assert.equal(v, 1.5);
});

test('stepperPrev respects min', () => {
  assert.equal(stepperPrev(0.9, 0.1, 0.8, 2.0), 0.8);
  assert.equal(stepperPrev(0.8, 0.1, 0.8, 2.0), 0.8);
});
