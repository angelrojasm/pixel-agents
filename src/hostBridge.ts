/**
 * Host abstraction over the few VS Code APIs that shared modules still reach for.
 *
 * `agentManager` and `fileWatcher` are imported by BOTH hosts — the VS Code
 * extension and the standalone daemon (`bin/serve.ts` → `daemon/orchestrator.ts`).
 * A static `import * as vscode` in either module makes the daemon bundle
 * unloadable outside the extension host, because `vscode` is injected by VS Code
 * at runtime and has no installable implementation.
 *
 * Everything those modules actually needed reduces to two questions: which
 * workspace folders are open, and which terminals does the host own. Both have a
 * well-defined answer in daemon mode: none. See `daemonHostBridge`.
 *
 * Registered once at startup, mirroring the `setHookProvider` / `setTeamProvider`
 * convention already used by these modules. `bin/__tests__/no-vscode-dependency.test.ts`
 * fails the build if a `vscode` import ever reappears in the daemon's graph.
 */

/**
 * A terminal owned by the host UI. Structurally a subset of `vscode.Terminal`,
 * so a real `vscode.Terminal` satisfies it without adaptation.
 */
export interface HostTerminal {
  readonly name: string;
  readonly exitStatus?: { readonly code: number | undefined } | undefined;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface HostBridge {
  /** Absolute paths of the open workspace folders, in order. */
  workspaceFolders(): string[];
  /** Terminals owned by the host UI. */
  terminals(): readonly HostTerminal[];
  /** The currently focused host terminal, if any. */
  activeTerminal(): HostTerminal | undefined;
}

/**
 * The daemon's bridge: no workspace, no host-owned terminals.
 *
 * This is the literal truth outside VS Code, not a stub — the daemon spawns
 * agents through `PtyManager` and has no workspace concept. Callers already
 * handle it: cwd resolution falls through to `defaultCwd` then `os.homedir()`,
 * and terminal-adoption scans simply find nothing to adopt.
 */
export const daemonHostBridge: HostBridge = {
  workspaceFolders: () => [],
  terminals: () => [],
  activeTerminal: () => undefined,
};

let current: HostBridge = daemonHostBridge;

/** Install the host's bridge. The extension calls this during activation. */
export function setHostBridge(bridge: HostBridge): void {
  current = bridge;
}

/** The active bridge. Defaults to {@link daemonHostBridge} until a host installs one. */
export function host(): HostBridge {
  return current;
}
