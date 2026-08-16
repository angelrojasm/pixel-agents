import * as fs from 'node:fs';
import * as realOs from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated HOME — the provider constructor reads/writes ~/.pixel-agents
// (config store, server.json). Never let the test see the real one.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('os')>('node:os');
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } };
});

import type * as vscode from 'vscode';

import { PixelAgentsViewProvider } from '../PixelAgentsViewProvider.js';

function makeContext(): vscode.ExtensionContext {
  return {
    extensionUri: { fsPath: '/nonexistent-ext' },
    extensionPath: '/nonexistent-ext',
    extension: { packageJSON: { version: '0.0.0-test' } },
    workspaceState: {
      get: () => false,
      update: () => Promise.resolve(),
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
  } as unknown as vscode.ExtensionContext;
}

describe('provider dispatch delegation', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'px-provider-'));
    fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('forwards a webview message to the shared dispatch with a per-view replySink', async () => {
    const provider = new PixelAgentsViewProvider(makeContext());
    try {
      const recorded: Array<{
        message: Record<string, unknown>;
        ctx: { replySink: { postMessage(m: unknown): Thenable<boolean> } };
      }> = [];
      (provider as unknown as { uiDispatch: unknown }).uiDispatch = {
        handle: async (
          message: Record<string, unknown>,
          ctx: { replySink: { postMessage(m: unknown): Thenable<boolean> } },
        ) => void recorded.push({ message, ctx }),
      };

      const posted: unknown[] = [];
      const fakeWebview = {
        postMessage: (m: unknown) => {
          posted.push(m);
          return Promise.resolve(true);
        },
      } as unknown as vscode.Webview;

      await (
        provider as unknown as {
          handleWebviewMessage(m: Record<string, unknown>, w?: vscode.Webview): Promise<void>;
        }
      ).handleWebviewMessage({ type: 'saveLayout', layout: {} }, fakeWebview);

      expect(recorded).toHaveLength(1);
      expect(recorded[0].message.type).toBe('saveLayout');
      await recorded[0].ctx.replySink.postMessage({ type: 'x' });
      expect(posted).toEqual([{ type: 'x' }]);
    } finally {
      (provider as unknown as { pixelAgentsServer: { stop(): void } }).pixelAgentsServer.stop();
      provider.dispose();
    }
  });
});
