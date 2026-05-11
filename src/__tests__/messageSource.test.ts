import { describe, expect, it } from 'vitest';

import { webviewMessageSource } from '../messageSource.js';

// Minimal mock that matches the shape of `vscode.Webview` for our purposes.
function makeMockWebview() {
  type Handler = (m: Record<string, unknown>) => unknown;
  const handlers: Handler[] = [];
  return {
    handlers,
    onDidReceiveMessage(h: Handler) {
      handlers.push(h);
      return {
        dispose: () => {
          const idx = handlers.indexOf(h);
          if (idx >= 0) handlers.splice(idx, 1);
        },
      };
    },
    emit(message: Record<string, unknown>) {
      for (const h of handlers) h(message);
    },
  };
}

describe('webviewMessageSource', () => {
  it('forwards messages from the wrapped webview to the registered handler', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const received: Record<string, unknown>[] = [];

    source.onMessage((m) => received.push(m));
    mock.emit({ type: 'ping' });
    mock.emit({ type: 'pong', n: 2 });

    expect(received).toEqual([{ type: 'ping' }, { type: 'pong', n: 2 }]);
  });

  it('returns a disposable that detaches the handler', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const received: Record<string, unknown>[] = [];

    const sub = source.onMessage((m) => received.push(m));
    mock.emit({ type: 'before' });
    sub.dispose();
    mock.emit({ type: 'after' });

    expect(received).toEqual([{ type: 'before' }]);
  });

  it('supports multiple independent handlers on the same source', () => {
    const mock = makeMockWebview();
    const source = webviewMessageSource(mock as never);
    const a: Record<string, unknown>[] = [];
    const b: Record<string, unknown>[] = [];

    source.onMessage((m) => a.push(m));
    source.onMessage((m) => b.push(m));
    mock.emit({ type: 'broadcast' });

    expect(a).toEqual([{ type: 'broadcast' }]);
    expect(b).toEqual([{ type: 'broadcast' }]);
  });

  it('does not throw when emit happens with no handlers registered', () => {
    const mock = makeMockWebview();
    webviewMessageSource(mock as never); // intentionally no .onMessage

    expect(() => mock.emit({ type: 'orphan' })).not.toThrow();
  });
});
