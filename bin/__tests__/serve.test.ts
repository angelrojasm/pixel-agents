import { describe, it, expect } from 'vitest';
import { startDaemon } from '../serve.js';

describe('startDaemon', () => {
  it('starts on an ephemeral port, exposes config, and stops cleanly', async () => {
    const { server, stop } = await startDaemon({ open: false });
    const cfg = server.getConfig();
    expect(cfg?.port).toBeGreaterThan(0);
    expect(cfg?.token).toMatch(/^[a-f0-9-]+$/);
    await stop();
  });
});
