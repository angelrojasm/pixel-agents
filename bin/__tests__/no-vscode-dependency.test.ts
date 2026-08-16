import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';
import { describe, it, expect } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The daemon must run outside the VS Code extension host, where the `vscode`
 * module does not exist (it is injected by VS Code at runtime and has no
 * installable implementation — only `@types/vscode`).
 *
 * This bundles the daemon entrypoint for real, WITHOUT marking `vscode`
 * external. If anything in the daemon's import graph reaches the VS Code API,
 * esbuild fails to resolve it and this test fails with the offending import
 * chain. That makes the leak impossible to reintroduce silently — the unit
 * suite otherwise hides it, because vitest aliases `vscode` to a stub.
 */
describe('daemon bundle', () => {
  it('builds without any dependency on the vscode module', async () => {
    const result = await esbuild.build({
      entryPoints: [path.join(repoRoot, 'bin', 'serve.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      // Only the native module is external. `vscode` is deliberately NOT listed:
      // it must not appear in the graph at all.
      external: ['node-pty'],
      write: false,
      logLevel: 'silent',
      metafile: true,
    });

    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.filter((i) => /(^|\/)vscode$/.test(i))).toEqual([]);
  });
});
