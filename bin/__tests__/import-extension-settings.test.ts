import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { importSettings } from '../import-extension-settings.js';

describe('importSettings', () => {
  it('reads a dump file and writes to the specified config.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-import-'));
    const dumpFile = path.join(tmp, 'dump.json');
    const configFile = path.join(tmp, '.pixel-agents', 'config.json');

    fs.writeFileSync(
      dumpFile,
      JSON.stringify({
        'pixel-agents.soundEnabled': false,
        'pixel-agents.alwaysShowLabels': true,
      }),
    );

    importSettings(dumpFile, configFile);

    const out = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
    expect(out['pixel-agents.soundEnabled']).toBe(false);
    expect(out['pixel-agents.alwaysShowLabels']).toBe(true);
  });

  it('imports all supported key types (string, number, boolean)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-import-'));
    const dumpFile = path.join(tmp, 'dump.json');
    const configFile = path.join(tmp, '.pixel-agents', 'config.json');

    fs.writeFileSync(
      dumpFile,
      JSON.stringify({
        'pixel-agents.soundEnabled': true,
        'pixel-agents.lastSeenVersion': '1.2.3',
        'pixel-agents.alwaysShowLabels': false,
        'pixel-agents.watchAllSessions': false,
        'pixel-agents.hooksEnabled': true,
        'pixel-agents.hooksInfoShown': true,
        'pixel-agents.showTerminalNames': true,
        'pixel-agents.defaultCwd': '/home/user/projects',
        'pixel-agents.usePtyTerminal': false,
        'pixel-agents.terminalFontFamily': 'Fira Code',
        'pixel-agents.terminalLineHeight': 1.5,
      }),
    );

    importSettings(dumpFile, configFile);

    const out = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
    expect(out['pixel-agents.soundEnabled']).toBe(true);
    expect(out['pixel-agents.lastSeenVersion']).toBe('1.2.3');
    expect(out['pixel-agents.alwaysShowLabels']).toBe(false);
    expect(out['pixel-agents.watchAllSessions']).toBe(false);
    expect(out['pixel-agents.hooksEnabled']).toBe(true);
    expect(out['pixel-agents.hooksInfoShown']).toBe(true);
    expect(out['pixel-agents.showTerminalNames']).toBe(true);
    expect(out['pixel-agents.defaultCwd']).toBe('/home/user/projects');
    expect(out['pixel-agents.usePtyTerminal']).toBe(false);
    expect(out['pixel-agents.terminalFontFamily']).toBe('Fira Code');
    expect(out['pixel-agents.terminalLineHeight']).toBe(1.5);
  });

  it('throws if the dump file does not exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-import-'));
    const configFile = path.join(tmp, '.pixel-agents', 'config.json');

    expect(() => importSettings(path.join(tmp, 'nonexistent.json'), configFile)).toThrow(
      'No dump found at',
    );
  });

  it('creates the config directory if it does not exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-import-'));
    const dumpFile = path.join(tmp, 'dump.json');
    const configFile = path.join(tmp, 'nested', 'dir', 'config.json');

    fs.writeFileSync(dumpFile, JSON.stringify({ 'pixel-agents.soundEnabled': false }));

    importSettings(dumpFile, configFile);

    expect(fs.existsSync(configFile)).toBe(true);
    const out = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
    expect(out['pixel-agents.soundEnabled']).toBe(false);
  });
});
