import * as fs from 'node:fs';
import * as path from 'node:path';
import * as realOs from 'node:os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';

// Isolated HOME. Without it, PixelAgentsServer.start() finds the ambient
// ~/.pixel-agents/server.json and REUSES a live server owned by a running VS Code
// extension host — these assertions would then run against that process instead
// of the one under test (a 404 on the WS upgrade, since older builds have no /ws).
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('os')>('node:os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});

const { PixelAgentsServer } = await import('../../server/src/server.js');

describe('PixelAgentsServer WebSocket', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-ws-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('accepts a connection from an allowed origin with the correct token', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
        origin: `http://127.0.0.1:${cfg.port}`,
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 1000);
      });
      ws.close();
    } finally {
      server.stop();
    }
  });

  it('rejects on bad origin (socket closes; no open event fires within timeout)', async () => {
    const server = new PixelAgentsServer();
    const cfg = await server.start();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws?token=${cfg.token}`, {
        origin: 'http://evil.example',
      });
      const result = await Promise.race([
        new Promise<'open'>((resolve) => ws.on('open', () => resolve('open'))),
        new Promise<'closed'>((resolve) => {
          ws.on('error', () => resolve('closed'));
          ws.on('close', () => resolve('closed'));
        }),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
      ]);
      expect(result).toBe('closed');
      expect(ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING).toBe(true);
    } finally {
      server.stop();
    }
  });
});
