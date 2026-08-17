import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRequestedCwd } from '../agentManager';

describe('resolveRequestedCwd', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-cwd-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses an explicit existing folderPath', () => {
    expect(resolveRequestedCwd(dir, [], '')).toBe(dir);
  });

  it('falls through to the first workspace folder when folderPath does not exist', () => {
    expect(resolveRequestedCwd('/no/such/dir', [dir], '')).toBe(dir);
  });

  it('falls through to defaultCwd, then homedir', () => {
    expect(resolveRequestedCwd(undefined, [], dir)).toBe(dir);
    expect(resolveRequestedCwd(undefined, [], '/also/missing')).toBe(os.homedir());
  });

  it('expands ~ in an explicit folderPath', () => {
    // homedir always exists; '~' should resolve to it
    expect(resolveRequestedCwd('~', [], '')).toBe(os.homedir());
  });
});
