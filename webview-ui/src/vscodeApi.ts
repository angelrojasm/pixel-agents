import { isBrowserRuntime } from './runtime';

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

const browserFallback: VSCodeApi = {
  postMessage: (msg: unknown) => console.log('[vscode.postMessage]', msg),
  getState: () => undefined,
  setState: (state) => state,
};

export const vscode: VSCodeApi = isBrowserRuntime
  ? browserFallback
  : (acquireVsCodeApi() as VSCodeApi);
