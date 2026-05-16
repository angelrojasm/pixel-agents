import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createConfigStore } from '../daemon/configStore.js';

/**
 * Reads a settings dump produced by the `pixel-agents.exportSettings` VS Code command
 * and writes each key/value into a ConfigStore backed by the given config file path.
 *
 * Exported so tests can call it directly without a subprocess.
 */
export function importSettings(
  dumpPath: string,
  configFilePath: string = path.join(os.homedir(), '.pixel-agents', 'config.json'),
): void {
  if (!fs.existsSync(dumpPath)) {
    throw new Error(
      `No dump found at ${dumpPath}. Run "Pixel Agents: Export Settings" from VS Code first.`,
    );
  }
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf-8')) as Record<string, unknown>;
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
  const store = createConfigStore(configFilePath);
  for (const [k, v] of Object.entries(dump)) store.update(k, v);
  console.log(`Imported ${Object.keys(dump).length} settings into ${configFilePath}`);
}

function main() {
  const inputPath = process.argv[2] ?? path.join(os.tmpdir(), 'pixel-agents-settings-dump.json');
  importSettings(inputPath);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
