import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { WebSocketSink, WebSocketBroadcast, WebSocketSource } from '../wsTransport.js';

function fakeWs(state: 'OPEN' | 'CLOSED' = 'OPEN') {
  const send = vi.fn();
  const onCb: Record<string, (data: unknown) => void> = {};
  return {
    readyState: state === 'OPEN' ? 1 : 3,
    OPEN: 1,
    send,
    on: (evt: string, cb: (d: unknown) => void) => {
      onCb[evt] = cb;
    },
    off: vi.fn(),
    _emit: (evt: string, d: unknown) => onCb[evt]?.(d),
  } as unknown as WebSocket & { _emit: (e: string, d: unknown) => void };
}

describe('WebSocketSink', () => {
  it('JSON-stringifies and writes to the underlying socket', async () => {
    const ws = fakeWs('OPEN');
    const sink = new WebSocketSink(ws);
    await sink.postMessage({ type: 'hello', n: 1 });
    expect(ws.send as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('{"type":"hello","n":1}');
  });
});

describe('WebSocketBroadcast', () => {
  it('fans messages to every OPEN client, skips CLOSED ones', async () => {
    const open1 = fakeWs('OPEN');
    const open2 = fakeWs('OPEN');
    const closed = fakeWs('CLOSED');
    const clients = new Set([open1, open2, closed]);
    const bcast = new WebSocketBroadcast(clients);
    await bcast.postMessage({ type: 'ping' });
    expect(open1.send as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(open2.send as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(closed.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe('WebSocketSource', () => {
  it('parses inbound JSON and invokes the handler', () => {
    const ws = fakeWs('OPEN');
    const src = new WebSocketSource(ws);
    const handler = vi.fn();
    src.onMessage(handler);
    ws._emit('message', Buffer.from('{"type":"clicked","id":7}'));
    expect(handler).toHaveBeenCalledWith({ type: 'clicked', id: 7 });
  });
});
