export interface CrashRecord {
  code: number;
  signal: string | null;
}

export interface CrashState {
  crashedAgents: Record<number, CrashRecord>;
}

export type CrashAction =
  | { type: 'agentCrashed'; agentId: number; code: number; signal: string | undefined }
  | { type: 'crashAcknowledged'; agentId: number }
  | { type: 'agentRestarted'; agentId: number }
  | { type: 'agentClosed'; agentId: number };

export const crashInitialState: CrashState = { crashedAgents: {} };

export function applyCrashAction(state: CrashState, action: CrashAction): CrashState {
  switch (action.type) {
    case 'agentCrashed':
      return {
        crashedAgents: {
          ...state.crashedAgents,
          [action.agentId]: { code: action.code, signal: action.signal ?? null },
        },
      };
    case 'crashAcknowledged':
      // Renderer reads ch.crashedAcknowledged for the glyph; reducer keeps
      // the crash record so a webview reload re-glyphs correctly.
      return state;
    case 'agentRestarted':
    case 'agentClosed': {
      if (!(action.agentId in state.crashedAgents)) return state;
      const next = { ...state.crashedAgents };
      delete next[action.agentId];
      return { crashedAgents: next };
    }
  }
}
