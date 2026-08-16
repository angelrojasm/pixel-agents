import * as vscode from 'vscode';

import type { HostBridge } from './hostBridge.js';

/**
 * The VS Code implementation of {@link HostBridge}.
 *
 * Deliberately isolated in its own module: it is imported ONLY from
 * `extension.ts`, which the daemon never loads. Importing it from a module that
 * `daemon/orchestrator.ts` reaches would put `vscode` back in the daemon's
 * bundle graph and break `node dist/bin/serve.js`.
 *
 * `vscode.Terminal` structurally satisfies `HostTerminal`, so the terminal
 * arrays pass through unadapted (identity is preserved, which matters — callers
 * compare `agent.terminalRef === activeTerminal`).
 */
export const vscodeHostBridge: HostBridge = {
  workspaceFolders: () => vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
  terminals: () => vscode.window.terminals,
  activeTerminal: () => vscode.window.activeTerminal,
};
