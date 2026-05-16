import type { ConfigStore } from '../daemon/configStore.js';
import type { SettingsCategory } from './constants.js';
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_DEFAULT_CWD,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_SHOW_TERMINAL_NAMES,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_TERMINAL_FONT_FAMILY,
  GLOBAL_KEY_TERMINAL_LINE_HEIGHT,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
} from './constants.js';

export function resolveCategoryDefaults<C extends SettingsCategory>(
  category: C,
  override: (typeof DEFAULT_SETTINGS)[C] | undefined,
): (typeof DEFAULT_SETTINGS)[C] {
  if (override) return override;
  const v = DEFAULT_SETTINGS[category];
  if (!v) throw new Error(`Unknown settings category: ${category}`);
  return v;
}

/** Narrow broadcast sink so this helper doesn't pull in the larger MessageSink type. */
export interface BroadcastLike {
  postMessage(message: unknown): unknown;
}

/** Hook for the `office` category — externalAssetDirectories lives in
 *  ~/.pixel-agents/config.json, not VS Code globalState. The provider supplies
 *  the actual config read/write functions; tests supply spies. */
export interface OfficeConfigIO {
  read(): { externalAssetDirectories: string[] };
  write(cfg: { externalAssetDirectories: string[] }): void;
}

/** Apply category defaults: write each setting key to the config store (or for
 *  `office`, to the config file via the supplied IO hooks), then broadcast any
 *  category-specific follow-up message. Returns the resolved defaults applied,
 *  for tests + caller introspection. */
export function applyCategoryDefaults(
  category: SettingsCategory,
  override: Partial<(typeof DEFAULT_SETTINGS)[SettingsCategory]> | undefined,
  deps: {
    config: ConfigStore;
    broadcast: BroadcastLike;
    office?: OfficeConfigIO;
  },
): (typeof DEFAULT_SETTINGS)[SettingsCategory] {
  if (category === 'general') {
    const v = resolveCategoryDefaults(
      'general',
      override as (typeof DEFAULT_SETTINGS)['general'] | undefined,
    );
    deps.config.update(GLOBAL_KEY_SOUND_ENABLED, v.soundEnabled);
    deps.config.update(GLOBAL_KEY_ALWAYS_SHOW_LABELS, v.alwaysShowLabels);
    deps.config.update(GLOBAL_KEY_SHOW_TERMINAL_NAMES, v.showTerminalNames);
    // debugMode is webview-local; mirror it to all webviews so multi-webview
    // instances reset their local state in sync.
    deps.broadcast.postMessage({ type: 'setDebugMode', enabled: v.debugMode });
    return v;
  }
  if (category === 'agents') {
    const v = resolveCategoryDefaults(
      'agents',
      override as (typeof DEFAULT_SETTINGS)['agents'] | undefined,
    );
    deps.config.update(GLOBAL_KEY_WATCH_ALL_SESSIONS, v.watchAllSessions);
    deps.config.update(GLOBAL_KEY_HOOKS_ENABLED, v.hooksEnabled);
    deps.config.update(GLOBAL_KEY_DEFAULT_CWD, v.defaultCwd);
    return v;
  }
  if (category === 'terminal') {
    const v = resolveCategoryDefaults(
      'terminal',
      override as (typeof DEFAULT_SETTINGS)['terminal'] | undefined,
    );
    deps.config.update(GLOBAL_KEY_TERMINAL_FONT_FAMILY, v.fontFamily);
    deps.config.update(GLOBAL_KEY_TERMINAL_LINE_HEIGHT, v.lineHeight);
    return v;
  }
  if (category === 'office') {
    const v = resolveCategoryDefaults(
      'office',
      override as (typeof DEFAULT_SETTINGS)['office'] | undefined,
    );
    if (!deps.office) {
      throw new Error('applyCategoryDefaults: office requires deps.office IO hooks');
    }
    const config = deps.office.read();
    config.externalAssetDirectories = [...v.externalAssetDirectories];
    deps.office.write(config);
    deps.broadcast.postMessage({
      type: 'externalAssetDirectoriesUpdated',
      dirs: v.externalAssetDirectories,
    });
    return v;
  }
  throw new Error(`Unknown settings category: ${category}`);
}
