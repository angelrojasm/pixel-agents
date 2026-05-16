import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { type WebSocket, WebSocketServer } from 'ws';

import { injectMetaTag, serveStaticFile } from '../../daemon/staticServer.js';
import { acceptUpgrade } from '../../daemon/wsServer.js';
import { WebSocketBroadcast, WebSocketSink, WebSocketSource } from '../../daemon/wsTransport.js';

/**
 * Absolute path to the built SPA (webview-ui/dist/).
 * esbuild bundles server.ts as CJS and injects __dirname; fall back to
 * process.cwd() for unit-test environments that don't bundle.
 */
function getSpaRoot(): string {
  const here: string =
    ((global as unknown as Record<string, unknown>).__dirname as string) || process.cwd();
  return path.join(here, '..', '..', 'webview-ui', 'dist');
}
import {
  HOOK_API_PREFIX,
  HOOK_HEARTBEAT_INTERVAL_MS,
  MAX_HOOK_BODY_SIZE,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
} from './constants.js';
import { HealthMonitor, type HealthState } from './healthMonitor.js';

/** Discovery file written to ~/.pixel-agents/server.json so hook scripts can find the server. */
export interface ServerConfig {
  /** Port the HTTP server is listening on */
  port: number;
  /** PID of the process that owns the server */
  pid: number;
  /** Auth token required in Authorization header for hook requests */
  token: string;
  /** Timestamp (ms) when the server started */
  startedAt: number;
}

/** Callback invoked when a hook event is received from a provider's hook script. */
type HookEventCallback = (providerId: string, event: Record<string, unknown>) => void;

/**
 * HTTP server that receives hook events from CLI tool hook scripts.
 *
 * Routes:
 * - `POST /api/hooks/:providerId` -- hook event (auth required, 64KB body limit)
 * - `GET /api/health` -- health check (no auth)
 *
 * Discovery: writes `~/.pixel-agents/server.json` with port, PID, and auth token.
 * Multi-window: second VS Code window detects running server via server.json and
 * reuses it (does not start a second server).
 *
 * This will becomes the standalone server with added WebSocket and SPA serving.
 */
export class PixelAgentsServer {
  private server: http.Server | null = null;
  private config: ServerConfig | null = null;
  private ownsServer = false;
  private callback: HookEventCallback | null = null;
  private startTime = Date.now();
  private healthMonitor: HealthMonitor | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthListener: ((state: HealthState) => void) | null = null;

  private wss: WebSocketServer | null = null;
  private wsClients = new Set<WebSocket>();
  private wsBroadcast = new WebSocketBroadcast(this.wsClients);
  private wsConnectHandler:
    | ((src: WebSocketSource, perClientSink: WebSocketSink, broadcast: WebSocketBroadcast) => void)
    | null = null;

  /** Register a handler that fires for every new WebSocket connection. */
  onWebSocketConnect(
    cb: (src: WebSocketSource, perClientSink: WebSocketSink, broadcast: WebSocketBroadcast) => void,
  ): void {
    this.wsConnectHandler = cb;
  }

  /** Returns the shared broadcast sink that sends to all connected WebSocket clients. */
  getBroadcastSink(): WebSocketBroadcast {
    return this.wsBroadcast;
  }

  /** Register a callback for incoming hook events from any provider. */
  onHookEvent(callback: HookEventCallback): void {
    this.callback = callback;
  }

  /** Register a listener that fires on every hook-health state change. */
  onHealthChange(cb: (state: HealthState) => void): void {
    this.healthListener = cb;
  }

  /**
   * Start the HTTP server. If another instance is already running (detected via
   * server.json PID check), reuses that server's config without starting a new one.
   * @returns The server config (port, token) for hook script discovery.
   */
  async start(): Promise<ServerConfig> {
    // Check if another instance already has a server running
    const existing = this.readServerJson();
    if (existing && isProcessRunning(existing.pid)) {
      // Another VS Code window owns the server, reuse its config
      this.config = existing;
      this.ownsServer = false;
      console.log(
        `[Pixel Agents] Reusing existing server on port ${existing.port} (PID ${existing.pid})`,
      );
      return existing;
    }

    // Start our own server
    const token = crypto.randomUUID();
    this.startTime = Date.now();
    this.healthMonitor = new HealthMonitor({
      onChange: (s) => this.healthListener?.(s),
    });
    this.heartbeatTimer = setInterval(() => {
      this.healthMonitor?.tick();
    }, HOOK_HEARTBEAT_INTERVAL_MS);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);
      this.server.setTimeout(5000);

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.config = {
            port: addr.port,
            pid: process.pid,
            token,
            startedAt: this.startTime,
          };
          this.ownsServer = true;
          this.writeServerJson(this.config);
          // Replace startup error handler with runtime error handler
          this.server!.removeListener('error', reject);
          this.server!.on('error', (err) => {
            console.error(`[Pixel Agents] Server: error: ${err}`);
          });

          // Wire WebSocket upgrade handler
          this.wss = new WebSocketServer({ noServer: true });
          this.server!.on('upgrade', (req, sock, head) => {
            const port = this.config!.port;
            const decision = acceptUpgrade(req, {
              allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
              token: this.config!.token,
            });
            if (decision.kind === 'reject') {
              sock.write(`HTTP/1.1 ${decision.code} ${decision.reason}\r\n\r\n`);
              sock.destroy();
              return;
            }
            this.wss!.handleUpgrade(req, sock, head, (ws) => {
              this.wsClients.add(ws);
              ws.on('close', () => this.wsClients.delete(ws));
              this.wsConnectHandler?.(
                new WebSocketSource(ws),
                new WebSocketSink(ws),
                this.wsBroadcast,
              );
            });
          });

          console.log(`[Pixel Agents] Server: listening on 127.0.0.1:${addr.port}`);
          resolve(this.config);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  /** Stop the HTTP server and clean up server.json (only if we own it). */
  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.wsClients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Only delete server.json if we own it (our PID)
    if (this.ownsServer) {
      this.deleteServerJson();
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.healthMonitor?.dispose();
    this.healthMonitor = null;
    this.healthListener = null;
    this.config = null;
    this.ownsServer = false;
  }

  /** Returns the current server config, or null if not started. */
  getConfig(): ServerConfig | null {
    return this.config;
  }

  /** Returns the current hook-health state, or null when no transition has
   *  occurred yet (boot state — caller treats as "unknown / wait"). Late-
   *  mounting webviews call this on `webviewReady` to catch up to whatever the
   *  monitor has already broadcast. */
  getHealthState(): HealthState | null {
    return this.healthMonitor?.getState() ?? null;
  }

  /** Top-level request router. Dispatches to health or hook handler based on method + path. */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '';

    // Health endpoint (no auth required)
    if (req.method === 'GET' && url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
        }),
      );
      return;
    }

    // Hook event endpoint: POST /api/hooks/:providerId
    if (req.method === 'POST' && url.startsWith(HOOK_API_PREFIX + '/')) {
      this.handleHookRequest(req, res, url);
      return;
    }

    // Static SPA serving: GET /* → webview-ui/dist/
    if (req.method === 'GET') {
      const result = serveStaticFile({ root: getSpaRoot(), urlPath: url });
      if (result) {
        // Inject the auth token into index.html so the SPA can include it in
        // the WS URL without a separate API round-trip.
        let body: Buffer = result.body;
        if (result.contentType === 'text/html' && this.config) {
          body = Buffer.from(injectMetaTag(body.toString(), this.config.token));
        }
        res.writeHead(200, { 'Content-Type': result.contentType });
        res.end(body);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  }

  /** Handle POST /api/hooks/:providerId. Validates auth, enforces body size limit, parses JSON. */
  private handleHookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
  ): void {
    // Validate auth token (timing-safe comparison prevents side-channel attacks)
    const authHeader = req.headers['authorization'] ?? '';
    const expectedToken = `Bearer ${this.config?.token ?? ''}`;
    const authBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expectedToken);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }

    this.healthMonitor?.heartbeat();

    // Extract and validate provider ID from URL: /api/hooks/claude -> "claude"
    const providerId = url.slice(HOOK_API_PREFIX.length + 1);
    if (!providerId || !/^[a-z0-9-]+$/.test(providerId)) {
      res.writeHead(400);
      res.end('invalid provider id');
      return;
    }

    // Read body with size limit and response guard
    let body = '';
    let bodySize = 0;
    let responded = false;

    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_HOOK_BODY_SIZE && !responded) {
        responded = true;
        res.writeHead(413);
        res.end('payload too large');
        req.destroy();
        return;
      }
      if (!responded) {
        body += chunk.toString();
      }
    });

    req.on('end', () => {
      if (responded) return;
      try {
        const event = JSON.parse(body) as Record<string, unknown>;
        if (event.session_id && event.hook_event_name) {
          this.callback?.(providerId, event);
        }
        res.writeHead(200);
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('invalid json');
      }
    });
  }

  /** Returns the absolute path to ~/.pixel-agents/server.json. */
  private getServerJsonPath(): string {
    return path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);
  }

  /** Read and parse server.json. Returns null if missing or malformed. */
  private readServerJson(): ServerConfig | null {
    try {
      const filePath = this.getServerJsonPath();
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ServerConfig;
    } catch {
      return null;
    }
  }

  /** Write server.json atomically (tmp + rename) with mode 0o600. */
  private writeServerJson(config: ServerConfig): void {
    const filePath = this.getServerJsonPath();
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // Atomic write with restricted permissions
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      console.error(`[Pixel Agents] Failed to write server.json: ${e}`);
    }
  }

  /** Delete server.json only if the PID inside matches our process (safe for multi-window). */
  private deleteServerJson(): void {
    try {
      const filePath = this.getServerJsonPath();
      if (!fs.existsSync(filePath)) return;
      // Only delete if our PID matches (don't delete another instance's server file)
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ServerConfig;
      if (existing.pid === process.pid) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // File may already be gone
    }
  }
}

/** Check if a process is alive by sending signal 0 (no-op, just checks existence). */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
