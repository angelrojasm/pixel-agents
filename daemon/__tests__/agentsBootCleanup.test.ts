import { describe, it, expect } from 'vitest';
import { pruneDeadAgents } from '../agentsBootCleanup.js';

describe('pruneDeadAgents', () => {
  it('drops entries whose pid is no longer alive', () => {
    const file = {
      version: 1 as const,
      nextAgentId: 3,
      nextTerminalIndex: 3,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
          sessionId: 's1',
        },
        {
          id: 2,
          terminalName: 't2',
          jsonlFile: '/tmp/b',
          projectDir: '/tmp',
          palette: 1,
          hueShift: 0,
          sessionId: 's2',
        },
      ],
    };
    const pidOf = (sessionId: string) => (sessionId === 's1' ? 11111 : 22222);
    const alive = (pid: number) => pid === 11111;
    const cleaned = pruneDeadAgents(file, { pidOf, alive });
    expect(cleaned.agents.map((a) => a.sessionId)).toEqual(['s1']);
  });

  it('keeps external agents (no pid) intact', () => {
    const file = {
      version: 1 as const,
      nextAgentId: 2,
      nextTerminalIndex: 2,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
          isExternal: true,
        },
      ],
    };
    const cleaned = pruneDeadAgents(file, { pidOf: () => undefined, alive: () => false });
    expect(cleaned.agents).toHaveLength(1);
  });

  it('drops non-external agents whose PID is unknown (post-daemon-restart case)', () => {
    const file = {
      version: 1 as const,
      nextAgentId: 2,
      nextTerminalIndex: 2,
      agents: [
        {
          id: 1,
          terminalName: 't1',
          jsonlFile: '/tmp/a',
          projectDir: '/tmp',
          palette: 0,
          hueShift: 0,
          sessionId: 's1',
        },
      ],
    };
    // pidOf returns undefined => we have no record that this agent is alive.
    const cleaned = pruneDeadAgents(file, { pidOf: () => undefined, alive: () => false });
    expect(cleaned.agents).toHaveLength(0);
  });
});
