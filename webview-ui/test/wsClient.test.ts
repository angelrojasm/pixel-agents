import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createWsClient } from '../src/wsClient.ts';

// ---------------------------------------------------------------------------
// Minimal WebSocket fake — mimics the subset the client code relies on.
// ---------------------------------------------------------------------------
class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  // OPEN constant expected by the client on both static & instance
  static OPEN = 1;
  readonly OPEN = 1;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** Simulate a successful connection. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** Simulate an inbound server message. */
  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

// ---------------------------------------------------------------------------
// Install FakeWS as the global WebSocket before every test.
// ---------------------------------------------------------------------------
beforeEach(() => {
  (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS;
  FakeWS.last = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createWsClient', () => {
  it('queues messages before open and flushes on open', () => {
    const client = createWsClient({ url: 'ws://localhost/ws', onMessage: () => {} });
    client.postMessage({ type: 'hello' });
    assert.deepEqual(FakeWS.last!.sent, []);
    FakeWS.last!.open();
    assert.deepEqual(FakeWS.last!.sent, ['{"type":"hello"}']);
  });

  it('dispatches inbound JSON to onMessage', () => {
    const received: unknown[] = [];
    createWsClient({ url: 'ws://localhost/ws', onMessage: (m) => received.push(m) });
    FakeWS.last!.open();
    FakeWS.last!.receive({ type: 'agentCreated', id: 1 });
    assert.deepEqual(received, [{ type: 'agentCreated', id: 1 }]);
  });

  it('reconnects after close (queue persists across reconnect)', async () => {
    const client = createWsClient({
      url: 'ws://localhost/ws',
      onMessage: () => {},
      reconnectMs: 0,
    });
    FakeWS.last!.open();
    const firstWs = FakeWS.last!;
    firstWs.close();
    // Queue a message while disconnected
    client.postMessage({ type: 'queued-while-down' });
    // Give the reconnect timer (delay=0) a tick to fire
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(FakeWS.last!.url, 'ws://localhost/ws');
    assert.notEqual(FakeWS.last, firstWs, 'a new WebSocket should have been created');
    FakeWS.last!.open();
    assert.deepEqual(FakeWS.last!.sent, ['{"type":"queued-while-down"}']);
  });
});
