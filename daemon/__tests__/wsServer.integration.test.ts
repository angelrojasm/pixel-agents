import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { PixelAgentsServer } from '../../server/src/server.js';

describe('PixelAgentsServer WebSocket', () => {
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
