import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10_000,
    include: [
      '__tests__/**/*.test.ts',
      '../daemon/__tests__/**/*.test.ts',
      '../bin/__tests__/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      // Provide a minimal vscode stub so daemon/orchestrator (which imports
      // src/agentManager → vscode) can be loaded in the server test environment.
      vscode: path.resolve(import.meta.dirname, '../server/__mocks__/vscode.ts'),
    },
  },
});
