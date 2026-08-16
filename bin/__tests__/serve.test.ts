import * as fs from 'node:fs';
import * as path from 'node:path';
import * as realOs from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Isolated HOME so the daemon never touches the developer's real
// ~/.pixel-agents/ and never reuses a server.json owned by a running VS Code
// extension host (which would make these assertions hit the wrong process).
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('os')>('node:os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});

// Must import AFTER mock setup
const { startDaemon } = await import('../serve.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spaIndex = path.join(repoRoot, 'dist', 'webview', 'index.html');

describe('startDaemon', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-serve-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('starts on an ephemeral port, exposes config, and stops cleanly', async () => {
    const { server, stop } = await startDaemon({ open: false });
    const cfg = server.getConfig();
    expect(cfg?.port).toBeGreaterThan(0);
    expect(cfg?.token).toMatch(/^[a-f0-9-]+$/);
    expect(cfg?.pid).toBe(process.pid);
    await stop();
  });

  // Requires a built SPA (`npm run build:webview` → dist/webview). Skipped on a
  // clean checkout so the suite doesn't depend on build artifacts.
  it.skipIf(!fs.existsSync(spaIndex))('serves the built SPA at /', async () => {
    const { server, stop } = await startDaemon({ open: false });
    const cfg = server.getConfig();
    try {
      const res = await fetch(`http://127.0.0.1:${cfg?.port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<div id="root">');
      expect(html).toContain(`<meta name="px-token" content="${cfg?.token}">`);
    } finally {
      await stop();
    }
  });
});
