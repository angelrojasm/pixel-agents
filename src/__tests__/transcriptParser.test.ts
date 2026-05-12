import { describe, expect, it, vi } from 'vitest';

import { processTranscriptLine } from '../transcriptParser.js';
import type { AgentState, MessageSink } from '../types.js';

function makeAgent(id: number): AgentState {
  return {
    id,
    sessionId: 'session-xyz',
    isExternal: false,
    projectDir: '/tmp/proj',
    jsonlFile: '/tmp/proj/session-xyz.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    linesProcessed: 0,
    lastDataAt: 0,
    seenUnknownRecordTypes: new Set(),
  } as unknown as AgentState; // cast acceptable for unit test; runtime fields not all required
}

describe('custom-title record', () => {
  it('sets agent.customTitle and posts agentRenamed', () => {
    const agent = makeAgent(7);
    const agents = new Map([[7, agent]]);
    const sink: MessageSink = { postMessage: vi.fn() };
    const line = JSON.stringify({
      type: 'custom-title',
      customTitle: 'Frontend cleanup',
      sessionId: 'session-xyz',
    });

    processTranscriptLine(7, line, agents, new Map(), new Map(), sink);

    expect(agent.customTitle).toBe('Frontend cleanup');
    expect(sink.postMessage).toHaveBeenCalledWith({
      type: 'agentRenamed',
      id: 7,
      customTitle: 'Frontend cleanup',
    });
  });

  it('ignores custom-title with non-string title', () => {
    const agent = makeAgent(7);
    const agents = new Map([[7, agent]]);
    const sink: MessageSink = { postMessage: vi.fn() };
    const line = JSON.stringify({ type: 'custom-title', customTitle: 42, sessionId: 'x' });

    processTranscriptLine(7, line, agents, new Map(), new Map(), sink);

    expect(agent.customTitle).toBeUndefined();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });
});
