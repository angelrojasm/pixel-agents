import * as fs from 'node:fs';

export interface ConfigStore {
  get<T = unknown>(key: string): T | undefined;
  update(key: string, value: unknown): void;
  snapshot(): Record<string, unknown>;
}

export function createConfigStore(file: string): ConfigStore {
  const load = (): Record<string, unknown> => {
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  let data = load();
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  return {
    get<T>(key: string) {
      return data[key] as T | undefined;
    },
    update(key: string, value: unknown) {
      // Read-modify-write: reload from disk first to merge with any concurrent writes
      // (e.g. configPersistence.ts managing externalAssetDirectories on the same file).
      data = load();
      data[key] = value;
      save();
    },
    snapshot() {
      return { ...data };
    },
  };
}
