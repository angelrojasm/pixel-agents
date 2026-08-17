import { isBrowserRuntime as defaultIsBrowserRuntime } from '../../runtime.js';

interface HandleWebLinkClickDeps {
  isBrowserRuntime?: boolean;
  windowOpen?: typeof window.open;
}

/**
 * Click handler for xterm.js WebLinksAddon. The browser runtime opens the URL
 * directly. The terminal band is browser-gated in M1, so no VS Code branch
 * exists yet — M2 must declare an `openExternal` ClientMessage in
 * core/asyncapi.yaml before mounting the pane in a webview (links there
 * cannot window.open). Dependencies are injectable for testing.
 */
export function handleWebLinkClick(
  _event: MouseEvent,
  uri: string,
  deps: HandleWebLinkClickDeps = {},
): void {
  const browser = deps.isBrowserRuntime ?? defaultIsBrowserRuntime;
  if (!browser) return;
  const opener = deps.windowOpen ?? window.open.bind(window);
  opener(uri, '_blank');
}
