/**
 * Minimal vscode stub for use in server/daemon test environments.
 * Only the surface used by src/agentManager.ts and transitively-imported
 * extension-side modules is mocked here. Add stubs as needed.
 */
export const workspace = {
  workspaceFolders: [] as Array<{
    uri: { fsPath: string };
    name: string;
    index: number;
  }>,
};

export const window = {
  terminals: [] as Array<{ name: string; exitStatus: unknown }>,
  activeTerminal: undefined as { name: string; exitStatus: unknown } | undefined,
};

export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  joinPath: (..._parts: unknown[]) => ({ fsPath: '' }),
  parse: (s: string) => ({ fsPath: s }),
};

export const env = {
  openExternal: () => Promise.resolve(true),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: () => Promise.resolve(undefined),
};

export const ViewColumn = { Active: 1 };

export class EventEmitter {
  event = () => ({ dispose: () => undefined });
  fire() {}
  dispose() {}
}
