import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createConfigStore } from '../configStore.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-cfg-'));
const file = path.join(tmp, 'config.json');

describe('createConfigStore', () => {
  it('reads and writes individual keys, persists between reloads', () => {
    const store = createConfigStore(file);
    expect(store.get<boolean>('soundEnabled')).toBeUndefined();
    store.update('soundEnabled', false);
    expect(store.get<boolean>('soundEnabled')).toBe(false);

    const store2 = createConfigStore(file);
    expect(store2.get<boolean>('soundEnabled')).toBe(false);
  });

  it('preserves existing keys when updating a new key (read-modify-write)', () => {
    const file2 = path.join(tmp, 'config2.json');
    const store = createConfigStore(file2);
    store.update('externalAssetDirectories', ['/some/path']);
    store.update('soundEnabled', true);

    // Both keys should coexist
    expect(store.get<string[]>('externalAssetDirectories')).toEqual(['/some/path']);
    expect(store.get<boolean>('soundEnabled')).toBe(true);

    // A fresh store sees both keys
    const store2 = createConfigStore(file2);
    expect(store2.get<string[]>('externalAssetDirectories')).toEqual(['/some/path']);
    expect(store2.get<boolean>('soundEnabled')).toBe(true);
  });

  it('snapshot returns a copy of current data', () => {
    const file3 = path.join(tmp, 'config3.json');
    const store = createConfigStore(file3);
    store.update('foo', 42);
    const snap = store.snapshot();
    expect(snap).toEqual({ foo: 42 });
    // Mutating the snapshot does not affect the store
    snap['foo'] = 99;
    expect(store.get<number>('foo')).toBe(42);
  });

  it('returns undefined for missing key without crashing', () => {
    const file4 = path.join(tmp, 'config4.json');
    const store = createConfigStore(file4);
    expect(store.get<string>('missing')).toBeUndefined();
  });
});
