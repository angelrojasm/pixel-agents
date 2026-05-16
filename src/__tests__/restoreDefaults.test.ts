import { describe, expect, it, vi } from 'vitest';

import type { ConfigStore } from '../../daemon/configStore.js';
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_TERMINAL_FONT_FAMILY,
  GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
  GLOBAL_KEY_USE_PTY_TERMINAL,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
} from '../constants.js';
import { applyCategoryDefaults, resolveCategoryDefaults } from '../settingsDefaults.js';

describe('resolveCategoryDefaults', () => {
  it('returns DEFAULT_SETTINGS slice when no override given', () => {
    const r = resolveCategoryDefaults('general', undefined);
    expect(r).toEqual(DEFAULT_SETTINGS.general);
  });

  it('returns the override when given (for undo)', () => {
    const snapshot = {
      ...DEFAULT_SETTINGS.general,
      soundEnabled: false,
    } as unknown as (typeof DEFAULT_SETTINGS)['general'];
    const r = resolveCategoryDefaults('general', snapshot);
    expect(r).toEqual(snapshot);
  });

  it('throws on unknown category', () => {
    expect(() => resolveCategoryDefaults('bogus' as never, undefined)).toThrow();
  });
});

function makeConfigStore(spy: (key: string, value: unknown) => void): ConfigStore {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    update(key: string, value: unknown) {
      store.set(key, value);
      spy(key, value);
    },
    snapshot() {
      return Object.fromEntries(store);
    },
  };
}

function makeDeps() {
  const update = vi.fn<(key: string, value: unknown) => void>();
  const postMessage = vi.fn();
  const officeRead = vi.fn(() => ({ externalAssetDirectories: ['/old/dir'] }));
  const officeWrite = vi.fn();
  const config = makeConfigStore(update);
  return {
    update,
    postMessage,
    officeRead,
    officeWrite,
    deps: {
      config,
      broadcast: { postMessage },
      office: { read: officeRead, write: officeWrite },
    },
  };
}

describe('applyCategoryDefaults', () => {
  it('general → writes sound/labels/terminal-names keys + broadcasts setDebugMode', () => {
    const { update, postMessage, deps } = makeDeps();
    const result = applyCategoryDefaults('general', undefined, deps);
    expect(result).toEqual(DEFAULT_SETTINGS.general);
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_SOUND_ENABLED,
      DEFAULT_SETTINGS.general.soundEnabled,
    );
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_ALWAYS_SHOW_LABELS,
      DEFAULT_SETTINGS.general.alwaysShowLabels,
    );
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_SHOW_TERMINAL_NAMES,
      DEFAULT_SETTINGS.general.showTerminalNames,
    );
    // debugMode broadcasts (webview-local state), not globalState.update
    expect(postMessage).toHaveBeenCalledWith({
      type: 'setDebugMode',
      enabled: DEFAULT_SETTINGS.general.debugMode,
    });
  });

  it('general → applies override (undo snapshot)', () => {
    const { update, postMessage, deps } = makeDeps();
    const snapshot = {
      soundEnabled: false,
      alwaysShowLabels: true,
      showTerminalNames: false,
      debugMode: true,
    } as unknown as (typeof DEFAULT_SETTINGS)['general'];
    applyCategoryDefaults('general', snapshot, deps);
    expect(update).toHaveBeenCalledWith(GLOBAL_KEY_SOUND_ENABLED, false);
    expect(update).toHaveBeenCalledWith(GLOBAL_KEY_ALWAYS_SHOW_LABELS, true);
    expect(update).toHaveBeenCalledWith(GLOBAL_KEY_SHOW_TERMINAL_NAMES, false);
    expect(postMessage).toHaveBeenCalledWith({ type: 'setDebugMode', enabled: true });
  });

  it('agents → writes watchAll/hooks/defaultCwd keys', () => {
    const { update, deps } = makeDeps();
    applyCategoryDefaults('agents', undefined, deps);
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_WATCH_ALL_SESSIONS,
      DEFAULT_SETTINGS.agents.watchAllSessions,
    );
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_HOOKS_ENABLED,
      DEFAULT_SETTINGS.agents.hooksEnabled,
    );
    expect(update).toHaveBeenCalledWith(GLOBAL_KEY_DEFAULT_CWD, DEFAULT_SETTINGS.agents.defaultCwd);
  });

  it('terminal → writes pty/font-family/line-height keys', () => {
    const { update, deps } = makeDeps();
    applyCategoryDefaults('terminal', undefined, deps);
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_USE_PTY_TERMINAL,
      DEFAULT_SETTINGS.terminal.usePtyTerminal,
    );
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_TERMINAL_FONT_FAMILY,
      DEFAULT_SETTINGS.terminal.fontFamily,
    );
    expect(update).toHaveBeenCalledWith(
      GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
      DEFAULT_SETTINGS.terminal.lineHeight,
    );
  });

  it('terminal default fontFamily matches the shipping Menlo stack', () => {
    // I2 finding: DEFAULT_SETTINGS.terminal.fontFamily must equal the literal
    // used by broadcastSettingsLoaded to avoid Restore Defaults switching the
    // user's font on click.
    expect(DEFAULT_SETTINGS.terminal.fontFamily).toBe('Menlo, Monaco, "Courier New", monospace');
  });

  it('office → reads + writes config, broadcasts externalAssetDirectoriesUpdated', () => {
    const { officeRead, officeWrite, postMessage, deps } = makeDeps();
    applyCategoryDefaults('office', undefined, deps);
    expect(officeRead).toHaveBeenCalled();
    expect(officeWrite).toHaveBeenCalledWith({
      externalAssetDirectories: [...DEFAULT_SETTINGS.office.externalAssetDirectories],
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'externalAssetDirectoriesUpdated',
      dirs: [...DEFAULT_SETTINGS.office.externalAssetDirectories],
    });
  });

  it('throws on unknown category', () => {
    const { deps } = makeDeps();
    expect(() => applyCategoryDefaults('bogus' as never, undefined, deps)).toThrow();
  });

  it('office without office IO throws', () => {
    const postMessage = vi.fn();
    const config = makeConfigStore(vi.fn<(key: string, value: unknown) => void>());
    expect(() =>
      applyCategoryDefaults('office', undefined, {
        config,
        broadcast: { postMessage },
      }),
    ).toThrow(/office requires deps.office/);
  });
});
