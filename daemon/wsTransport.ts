import type { WebSocket } from 'ws';
import type { MessageSink, MessageSource } from '../src/types.js';
import type { Disposable } from '../src/disposable.js';

export class WebSocketSink implements MessageSink {
  constructor(private ws: WebSocket) {}
  postMessage(msg: unknown): Promise<boolean> {
    this.ws.send(JSON.stringify(msg));
    return Promise.resolve(true);
  }
}

export class WebSocketBroadcast implements MessageSink {
  constructor(private clients: Set<WebSocket>) {}
  postMessage(msg: unknown): Promise<boolean> {
    const s = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.readyState === c.OPEN) c.send(s);
    }
    return Promise.resolve(true);
  }
}

export class WebSocketSource implements MessageSource {
  constructor(private ws: WebSocket) {}
  onMessage(handler: (m: Record<string, unknown>) => unknown): Disposable {
    const fn = (data: Buffer) => {
      try {
        handler(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        // malformed frame; drop
      }
    };
    this.ws.on('message', fn);
    return { dispose: () => this.ws.off('message', fn) };
  }
}
