import { isBrowserRuntime as defaultIsBrowserRuntime } from '../../runtime.js';
import { vscode as defaultVscode, type VSCodeApi } from '../../vscodeApi.js';

interface HandleWebLinkClickDeps {
  vscode?: VSCodeApi;
  isBrowserRuntime?: boolean;
  windowOpen?: typeof window.open;
}

/**
 * Click handler for xterm.js WebLinksAddon. In a VS Code webview, posts an
 * `openExternal` message to the extension. In a browser runtime (future
 * Phase 3 SPA), opens the URL directly via window.open.
 *
 * Dependencies are injectable for testing.
 */
export function handleWebLinkClick(
  _event: MouseEvent,
  uri: string,
  deps: HandleWebLinkClickDeps = {},
): void {
  const browser = deps.isBrowserRuntime ?? defaultIsBrowserRuntime;
  if (browser) {
    const opener = deps.windowOpen ?? window.open;
    opener(uri, '_blank');
    return;
  }
  const api = deps.vscode ?? defaultVscode;
  api.postMessage({ type: 'openExternal', uri });
}
