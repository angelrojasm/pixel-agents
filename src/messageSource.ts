import type * as vscode from 'vscode';

import type { MessageSource } from './types.js';

/**
 * Adapter that exposes a `vscode.Webview` through the transport-agnostic
 * `MessageSource` interface. Consumers register a handler via `onMessage(...)`
 * instead of touching `webview.onDidReceiveMessage` directly, so the inbound
 * path is ready to swap to a WebSocket transport in Phase 3 without changes
 * to the provider's message dispatch logic.
 */
export function webviewMessageSource(webview: vscode.Webview): MessageSource {
  return {
    onMessage(handler) {
      return webview.onDidReceiveMessage(handler);
    },
  };
}
