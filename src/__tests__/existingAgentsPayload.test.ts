import { describe, expect, it } from 'vitest';

import { buildExistingAgentsPayload } from '../agentManager';
import type { AgentState } from '../types';

function agent(partial: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 's',
    projectDir: '/p',
    jsonlFile: '/p/s.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    palette: 0,
    hueShift: 0,
    ...partial,
  } as AgentState;
}

describe('buildExistingAgentsPayload', () => {
  it('builds all six keys with sorted numeric ids', () => {
    const agents = new Map<number, AgentState>([
      [2, agent({ id: 2, palette: 1, hueShift: 45, workSeatId: 'seat-1', folderName: 'proj' })],
      [1, agent({ id: 1, isExternal: true, ptyBacked: true })],
    ]);
    const p = buildExistingAgentsPayload(agents);
    expect(Object.keys(p).sort()).toEqual([
      'agentMeta',
      'agents',
      'externalAgents',
      'folderNames',
      'ptyBackedAgents',
      'terminalNames',
    ]);
    expect(p.agents).toEqual([1, 2]);
    expect(p.agentMeta[2]).toEqual({ palette: 1, hueShift: 45, workSeatId: 'seat-1' });
    expect(p.folderNames).toEqual({ 2: 'proj' });
    expect(p.externalAgents).toEqual({ 1: true });
    expect(p.ptyBackedAgents).toEqual({ 1: true });
    expect(p.agents.every((id) => typeof id === 'number')).toBe(true);
  });

  it('pty agents (no terminalRef) keep their stored terminalName', () => {
    const agents = new Map<number, AgentState>([
      [1, agent({ id: 1, ptyBacked: true, terminalName: 'Claude Code #1' })],
    ]);
    const p = buildExistingAgentsPayload(agents);
    expect(p.terminalNames).toEqual({ 1: 'Claude Code #1' });
  });
});
