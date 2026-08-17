import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { PtyManager } from '../src/pty/ptyManager.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: false,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

function makeFakePtyHost() {
  return {
    stop: vi.fn(),
    disposeAll: vi.fn(),
    has: vi.fn(() => false),
  } as unknown as PtyManager;
}

describe('AgentRuntime -- pty host injection', () => {
  let runtime: AgentRuntime | undefined;

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
  });

  it('ptyHost is null until injected', () => {
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    expect(runtime.ptyHost).toBeNull();
  });

  it('setPtyHost exposes the host via the ptyHost getter', () => {
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    const host = makeFakePtyHost();
    runtime.setPtyHost(host);
    expect(runtime.ptyHost).toBe(host);
  });

  it('removeAgent stops the pty worker for that agent id', () => {
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    const host = makeFakePtyHost();
    runtime.setPtyHost(host);
    store.set(7, createTestAgent({ id: 7, sessionId: 'sess-7' }));
    runtime.removeAgent(7);
    expect(host.stop).toHaveBeenCalledWith(7);
    expect(store.get(7)).toBeUndefined();
  });

  it('removeAgent without a pty host still removes the agent', () => {
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    store.set(8, createTestAgent({ id: 8, sessionId: 'sess-8' }));
    runtime.removeAgent(8);
    expect(store.get(8)).toBeUndefined();
  });

  it('dispose tears down every pty worker', () => {
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    const host = makeFakePtyHost();
    runtime.setPtyHost(host);
    runtime.dispose();
    expect(host.disposeAll).toHaveBeenCalled();
    runtime = undefined; // already disposed
  });
});
