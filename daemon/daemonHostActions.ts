// daemon/daemonHostActions.ts
import type { HostActions } from './uiDispatch.js';

const na = (what: string) =>
  console.log(`[Pixel Agents] ${what}: not available in browser runtime`);

/** Daemon implementations of the host-only dispatch actions. Dialog-backed
 *  flows have browser-side equivalents (layout export/import) or are descoped
 *  (openSessionsFolder, add-asset-directory picker). */
export function createDaemonHostActions(): HostActions {
  return {
    focusTerminal: () => {}, // browser focus is client-local
    disposeTerminal: () => {}, // daemon agents never have terminalRef
    exportLayout: async () => na('exportLayout'), // browser exports client-side
    importLayoutViaDialog: async () => na('importLayout dialog'),
    openExternal: () => na('openExternal'), // browser opens links client-side
    openSessionsFolder: () => na('openSessionsFolder'),
    pickExternalAssetDirectory: async () => {
      na('addExternalAssetDirectory');
      return null;
    },
    getBypassPermissions: () => false,
    onAgentsLaunched: () => {}, // extension-only side effect
    onWebviewReady: async () => {}, // replay happens on WS connect only (spec)
  };
}
