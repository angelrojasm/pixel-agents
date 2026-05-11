/**
 * Wire types and runtime guards for the new pty protocol messages exchanged
 * between extension and webview. The guards exist so the provider can route
 * incoming messages safely without trusting the typing layer alone — inbound
 * messages cross a `postMessage` boundary that erases types at runtime.
 *
 * Outbound (extension → webview):
 *  - `ptyData` { agentId, data }
 *  - `ptyExit` { agentId, code, signal? }
 *  - `ptyScrollback` { agentId, lines: string[] }
 *
 * Inbound (webview → extension):
 *  - `ptyInput` { agentId, data }
 *  - `ptyResize` { agentId, cols, rows }
 *  - `terminalPaneReady` { agentId }
 */

export interface PtyDataMessage {
  type: 'ptyData';
  agentId: number;
  data: string;
}

export interface PtyExitMessage {
  type: 'ptyExit';
  agentId: number;
  code: number;
  signal?: string;
}

export interface PtyScrollbackMessage {
  type: 'ptyScrollback';
  agentId: number;
  lines: string[];
}

export interface PtyInputMessage {
  type: 'ptyInput';
  agentId: number;
  data: string;
}

export interface PtyResizeMessage {
  type: 'ptyResize';
  agentId: number;
  cols: number;
  rows: number;
}

export interface TerminalPaneReadyMessage {
  type: 'terminalPaneReady';
  agentId: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isPtyInputMessage(v: unknown): v is PtyInputMessage {
  if (!isRecord(v)) return false;
  return v.type === 'ptyInput' && typeof v.agentId === 'number' && typeof v.data === 'string';
}

export function isPtyResizeMessage(v: unknown): v is PtyResizeMessage {
  if (!isRecord(v)) return false;
  return (
    v.type === 'ptyResize' &&
    typeof v.agentId === 'number' &&
    typeof v.cols === 'number' &&
    v.cols > 0 &&
    typeof v.rows === 'number' &&
    v.rows > 0
  );
}

export function isTerminalPaneReadyMessage(v: unknown): v is TerminalPaneReadyMessage {
  if (!isRecord(v)) return false;
  return v.type === 'terminalPaneReady' && typeof v.agentId === 'number';
}
