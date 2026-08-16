import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_EXPORT_SETTINGS,
  COMMAND_OPEN_FULL_SCREEN,
  COMMAND_SHOW_PANEL,
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_HOOKS_INFO_SHOWN,
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_TERMINAL_FONT_FAMILY,
  GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
  VIEW_ID,
} from './constants.js';
import { setHostBridge } from './hostBridge.js';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';
import { vscodeHostBridge } from './vscodeHostBridge.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log(`[Pixel Agents] PIXEL_AGENTS_DEBUG=${process.env.PIXEL_AGENTS_DEBUG ?? 'not set'}`);

  // Install the VS Code host bridge before anything constructs agents or
  // watchers. Shared modules (agentManager, fileWatcher) resolve workspace
  // folders and host terminals through it; without this they'd fall back to the
  // daemon bridge and behave as if no workspace and no terminals existed.
  setHostBridge(vscodeHostBridge);

  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_FULL_SCREEN, () => {
      provider.openFullScreenPanel();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_SETTINGS, () => {
      const keys = [
        GLOBAL_KEY_SOUND_ENABLED,
        GLOBAL_KEY_LAST_SEEN_VERSION,
        GLOBAL_KEY_ALWAYS_SHOW_LABELS,
        GLOBAL_KEY_WATCH_ALL_SESSIONS,
        GLOBAL_KEY_HOOKS_ENABLED,
        GLOBAL_KEY_HOOKS_INFO_SHOWN,
        GLOBAL_KEY_SHOW_TERMINAL_NAMES,
        GLOBAL_KEY_DEFAULT_CWD,
        GLOBAL_KEY_TERMINAL_FONT_FAMILY,
        GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
      ];
      const dump: Record<string, unknown> = {};
      for (const k of keys) {
        const v = context.globalState.get(k);
        if (v !== undefined) dump[k] = v;
      }
      const out = path.join(os.tmpdir(), 'pixel-agents-settings-dump.json');
      fs.writeFileSync(out, JSON.stringify(dump, null, 2));
      void vscode.window.showInformationMessage(`Pixel Agents: Settings exported to ${out}`);
    }),
  );
}

export function deactivate() {
  providerInstance?.dispose();
}
