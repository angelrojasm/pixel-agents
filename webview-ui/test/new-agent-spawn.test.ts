import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSpawnRequest } from '../src/components/newAgentSpawn.ts';

test('blank fields spawn with defaults (empty payload)', () => {
  assert.deepEqual(buildSpawnRequest('', '', '~/code', false), {
    name: undefined,
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('name is trimmed; folder equal to the default is omitted', () => {
  assert.deepEqual(buildSpawnRequest('  Research Bot ', ' ~/code ', '~/code', false), {
    name: 'Research Bot',
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('a changed folder is passed through; bypass true is included', () => {
  assert.deepEqual(buildSpawnRequest('', '~/projects/fork', '~/code', true), {
    name: undefined,
    folderPath: '~/projects/fork',
    bypassPermissions: true,
  });
});
