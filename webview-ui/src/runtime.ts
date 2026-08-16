/**
 * Runtime detection, provider-agnostic
 *
 * Single source of truth for determining whether the webview is running
 * inside an IDE extension (VS Code, Cursor, Windsurf, etc.) or standalone
 * in a browser.
 */

declare function acquireVsCodeApi(): unknown;

type Runtime = 'vscode' | 'browser';
// Future: 'cursor' | 'windsurf' | 'electron' | etc.

const runtime: Runtime = typeof acquireVsCodeApi !== 'undefined' ? 'vscode' : 'browser';

export const isBrowserRuntime = runtime === 'browser';

/**
 * Whether the browser mock (client-side PNG decode + fake messages) should
 * run. Only on browser pages WITHOUT a daemon transport: a daemon-served page
 * carries a `px-token` meta tag and gets everything over the WebSocket —
 * running the mock there would build the office twice and mask transport bugs.
 */
export function shouldUseBrowserMock(doc: Pick<Document, 'querySelector'>): boolean {
  return isBrowserRuntime && doc.querySelector('meta[name="px-token"]') === null;
}
