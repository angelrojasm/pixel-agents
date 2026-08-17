import { expect, test } from 'vitest';

import { buildSpawnRequest } from '../src/components/newAgentSpawn.js';

test('blank fields spawn with defaults (empty payload)', () => {
  expect(buildSpawnRequest('', '', false)).toEqual({
    name: undefined,
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('name and folder are trimmed; whitespace-only counts as blank', () => {
  expect(buildSpawnRequest('  Research Bot ', '   ', false)).toEqual({
    name: 'Research Bot',
    folderPath: undefined,
    bypassPermissions: undefined,
  });
});

test('any non-blank folder is sent explicitly; bypass true is included', () => {
  expect(buildSpawnRequest('', ' ~/projects/fork ', true)).toEqual({
    name: undefined,
    folderPath: '~/projects/fork',
    bypassPermissions: true,
  });
});
