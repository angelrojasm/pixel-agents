import { isBrowserRuntime as defaultIsBrowserRuntime } from '../../runtime.js';
import { transport as defaultTransport } from '../../transport/index.js';

interface HandleWebLinkClickDeps {
  send?: (msg: Record<string, unknown>) => void;
  isBrowserRuntime?: boolean;
  windowOpen?: typeof window.open;
}

/**
 * Click handler for xterm.js WebLinksAddon. In the browser runtime the SPA
 * opens the URL directly; in a VS Code webview it asks the extension host to
 * open it externally. Dependencies are injectable for testing.
 */
export function handleWebLinkClick(
  _event: MouseEvent,
  uri: string,
  deps: HandleWebLinkClickDeps = {},
): void {
  const browser = deps.isBrowserRuntime ?? defaultIsBrowserRuntime;
  if (browser) {
    const opener = deps.windowOpen ?? window.open.bind(window);
    opener(uri, '_blank');
    return;
  }
  const send = deps.send ?? ((m: Record<string, unknown>) => defaultTransport.send(m as never));
  send({ type: 'openExternal', uri });
}
