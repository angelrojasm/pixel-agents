export interface WsClient {
  postMessage(msg: unknown): void;
  dispose(): void;
}

export interface WsClientOptions {
  url: string;
  onMessage: (msg: unknown) => void;
  /** Initial reconnect delay (ms). Subsequent attempts use exponential backoff
   *  up to 10s. Tests can set this to 0 to verify immediate reconnect. */
  reconnectMs?: number;
}

const MAX_BACKOFF_MS = 10_000;

export function createWsClient(opts: WsClientOptions): WsClient {
  const queue: string[] = [];
  let ws: WebSocket | null = null;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = () => {
    if (disposed) return;
    ws = new WebSocket(opts.url);
    ws.onopen = () => {
      attempt = 0; // reset backoff on a successful open
      while (queue.length) ws!.send(queue.shift()!);
    };
    ws.onmessage = (e) => {
      try {
        opts.onMessage(JSON.parse(typeof e.data === 'string' ? e.data : ''));
      } catch {
        /* malformed frame; drop */
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      const base = opts.reconnectMs ?? 500;
      const delay = Math.min(base * Math.pow(2, attempt++), MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    postMessage(msg: unknown) {
      const s = JSON.stringify(msg);
      if (ws && ws.readyState === ws.OPEN) ws.send(s);
      else queue.push(s);
    },
    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
