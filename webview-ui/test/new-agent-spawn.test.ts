import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSpawnRequest } from '../src/components/newAgentSpawn.ts';

test('blank fields spawn with defaults (empty payload)', () => {
  assert.deepEqual(buildSpawnRequest('', '', false), {
    name: undefined,
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('name and folder are trimmed; whitespace-only counts as blank', () => {
  assert.deepEqual(buildSpawnRequest('  Research Bot ', '   ', false), {
    name: 'Research Bot',
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('any non-blank folder is sent explicitly; bypass true is included', () => {
  assert.deepEqual(buildSpawnRequest('', ' ~/projects/fork ', true), {
    name: undefined,
    folderPath: '~/projects/fork',
    bypassPermissions: true,
  });
});
