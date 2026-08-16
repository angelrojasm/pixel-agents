import { PX_TOKEN_META_SELECTOR } from './constants';
import { isBrowserRuntime } from './runtime';
import { createWsClient } from './wsClient';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
};

export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): T;
}

function buildBrowserApi(): VSCodeApi {
  // Guard: only attempt WS + DOM construction when the full browser globals
  // are available. In Node-based test environments (Node test runner, vitest
  // jsdom without full globals) WebSocket and/or location may be undefined
  // even when isBrowserRuntime is true, so we fall back to a console no-op.
  if (typeof WebSocket === 'undefined' || typeof location === 'undefined') {
    return {
      postMessage: (msg: unknown) => console.log('[vscode.postMessage]', msg),
      getState: () => undefined,
      setState: (state) => state,
    };
  }

  const wsUrl = `ws://${location.host}/ws?token=${encodeURIComponent(
    document.querySelector<HTMLMetaElement>(PX_TOKEN_META_SELECTOR)?.content ?? '',
  )}`;

  const client = createWsClient({
    url: wsUrl,
    onMessage: (msg) => {
      window.dispatchEvent(new MessageEvent('message', { data: msg }));
    },
  });

  return {
    postMessage: (msg) => client.postMessage(msg),
    getState: <T>() =>
      localStorage.getItem('px-state')
        ? (JSON.parse(localStorage.getItem('px-state')!) as T)
        : undefined,
    setState: <T>(state: T) => {
      localStorage.setItem('px-state', JSON.stringify(state));
      return state;
    },
  };
}

/**
 * Lazily-initialized VSCodeApi instance.
 *
 * The browser branch (isBrowserRuntime) is built on *first access* rather
 * than at module-load time. This prevents crashes when the module is imported
 * from a Node-based test environment where `location`/`document`/`WebSocket`
 * do not exist as globals.
 */
function makeLazyApi(): VSCodeApi {
  let _api: VSCodeApi | undefined;
  const get = () => {
    if (!_api) _api = buildBrowserApi();
    return _api;
  };
  return new Proxy({} as VSCodeApi, {
    get(_target, prop: keyof VSCodeApi) {
      return get()[prop];
    },
  });
}

export const vscode: VSCodeApi = isBrowserRuntime
  ? makeLazyApi()
  : (acquireVsCodeApi() as VSCodeApi);
