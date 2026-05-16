import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readAgents, writeAgents, type AgentsFile } from '../agentsPersistence.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-agents-'));
const file = path.join(tmp, 'agents.json');

describe('agentsPersistence', () => {
  it('returns a fresh empty file when none exists', () => {
    const f = readAgents(file);
    expect(f).toEqual({ version: 1, nextAgentId: 1, nextTerminalIndex: 1, agents: [] });
  });

  it('writes atomically via tmp + rename', () => {
    const f: AgentsFile = {
      version: 1,
      nextAgentId: 2,
      nextTerminalIndex: 5,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a.jsonl',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
        },
      ],
    };
    writeAgents(file, f);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    expect(readAgents(file)).toEqual(f);
  });

  it('rejects unknown version', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 99, agents: [] }));
    expect(() => readAgents(file)).toThrow(/version/);
  });
});
