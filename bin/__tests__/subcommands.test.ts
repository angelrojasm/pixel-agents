import { describe, it, expect, vi } from 'vitest';
import { parseCommand, runInstallHooks, runUninstallHooks, runStop, runStatus } from '../serve.js';

describe('install-hooks', () => {
  it('delegates to claudeHookInstaller and returns exit code 0', async () => {
    const installer = { install: vi.fn().mockResolvedValue(undefined) };
    const code = await runInstallHooks({ installer });
    expect(installer.install).toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

describe('uninstall-hooks', () => {
  it('delegates to claudeHookInstaller.uninstall and returns 0', async () => {
    const installer = { uninstall: vi.fn().mockResolvedValue(undefined) };
    const code = await runUninstallHooks({ installer });
    expect(installer.uninstall).toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

describe('status', () => {
  it('reads server.json and prints port + PID; exits 0 when alive', async () => {
    const log = vi.fn();
    const code = await runStatus({
      readServerJson: () => ({ port: 12345, pid: 99999, token: 't', startedAt: 0 }),
      pidAlive: () => true,
      log,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('12345'));
    expect(code).toBe(0);
  });
  it('exits 1 when not running', async () => {
    const code = await runStatus({
      readServerJson: () => null,
      pidAlive: () => false,
      log: vi.fn(),
    });
    expect(code).toBe(1);
  });
});

describe('stop', () => {
  it('sends SIGTERM to the PID from server.json and exits 0', async () => {
    const kill = vi.fn();
    const code = await runStop({
      readServerJson: () => ({ port: 12345, pid: 99999, token: 't', startedAt: 0 }),
      kill,
    });
    expect(kill).toHaveBeenCalledWith(99999, 'SIGTERM');
    expect(code).toBe(0);
  });
});

describe('parseCommand', () => {
  it('defaults to serve when no argument is given', () => {
    expect(parseCommand(['node', 'serve.js'])).toBe('serve');
  });

  it('treats a leading flag as the implicit serve command', () => {
    // `node dist/bin/serve.js --no-open` must not be read as a subcommand named
    // "--no-open" (which used to exit 1 with "Unknown command").
    expect(parseCommand(['node', 'serve.js', '--no-open'])).toBe('serve');
  });

  it('still recognises explicit subcommands', () => {
    expect(parseCommand(['node', 'serve.js', 'status'])).toBe('status');
    expect(parseCommand(['node', 'serve.js', 'stop'])).toBe('stop');
    expect(parseCommand(['node', 'serve.js', 'serve', '--no-open'])).toBe('serve');
  });

  it('passes an unknown subcommand through so the caller can reject it', () => {
    expect(parseCommand(['node', 'serve.js', 'frobnicate'])).toBe('frobnicate');
  });
});
