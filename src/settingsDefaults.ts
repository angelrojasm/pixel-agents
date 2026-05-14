import type { SettingsCategory } from './constants.js';
import { DEFAULT_SETTINGS } from './constants.js';

export function resolveCategoryDefaults<C extends SettingsCategory>(
  category: C,
  override: (typeof DEFAULT_SETTINGS)[C] | undefined,
): (typeof DEFAULT_SETTINGS)[C] {
  if (override) return override;
  const v = DEFAULT_SETTINGS[category];
  if (!v) throw new Error(`Unknown settings category: ${category}`);
  return v;
}
