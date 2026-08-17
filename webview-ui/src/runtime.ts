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
 * True only under the Playwright e2e harness, which sets `__PIXEL_AGENTS_E2E`
 * via `addInitScript` before any app code runs (so it's set in every frame,
 * including the VS Code webview iframe). Gates test-only diagnostics
 * (window.__pixelAgentsTestHooks message/sound logs, the addAgent wrapper) so
 * they never run, and never grow unbounded, in a real user's session.
 */
export const isE2E: boolean =
  typeof window !== 'undefined' &&
  (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E === true;

/**
 * Whether this session can drive terminals: the browser runtime is privileged
 * only when opened from the tokened URL the CLI printed (`?token=` on the
 * page; the transport forwards it on the /ws handshake). Untokened viewers
 * still watch the office but receive no pty frames — rendering the terminal
 * band for them would show a dead, empty terminal. VS Code webviews are
 * always privileged (in-process Bearer token).
 */
export const hasPrivilegedToken: boolean =
  !isBrowserRuntime ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('token'));
