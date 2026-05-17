import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      // Provide a minimal vscode stub so modules that import src/agentManager
      // (which transitively imports vscode) can be loaded in test environments.
      vscode: path.resolve(__dirname, 'server/__mocks__/vscode.ts'),
    },
  },
});
