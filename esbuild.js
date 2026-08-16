const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
  const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
  const dstDir = path.join(__dirname, 'dist', 'assets');

  if (fs.existsSync(srcDir)) {
    // Remove existing dist/assets if present
    if (fs.existsSync(dstDir)) {
      fs.rmSync(dstDir, { recursive: true });
    }

    // Copy recursively
    fs.cpSync(srcDir, dstDir, { recursive: true });
    console.log('✓ Copied assets/ → dist/assets/');
  } else {
    console.log('ℹ️  assets/ folder not found (optional)');
  }
}

/**
 * Copy node-pty (and its native prebuilds) into dist/node_modules so the
 * packaged VSIX ships the native binding. The extension is loaded by VS Code
 * from `<extensionDir>/dist/extension.js`; Node's require resolution walks up
 * from there and finds `dist/node_modules/node-pty/`. This is the only way to
 * include node-pty when packaging with `--no-dependencies`, since vsce
 * hard-codes a `node_modules/**` exclude at the top level (the negate in
 * `.vscodeignore` cannot re-include files that were never collected). A
 * nested `dist/node_modules/` is unaffected by vsce's top-level filter.
 */
function copyNodePty() {
  const srcDir = path.join(__dirname, 'node_modules', 'node-pty');
  const dstDir = path.join(__dirname, 'dist', 'node_modules', 'node-pty');
  if (!fs.existsSync(srcDir)) {
    console.warn('⚠️  node_modules/node-pty not found — skipping copy');
    return;
  }
  if (fs.existsSync(dstDir)) {
    fs.rmSync(dstDir, { recursive: true });
  }
  fs.mkdirSync(dstDir, { recursive: true });
  // Only ship runtime-essential files. Skip build-time sources/headers
  // (`deps/`, `src/`, `third_party/`, `binding.gyp`, etc.) — those are only
  // needed for compiling the native module from scratch. We ship the
  // already-compiled prebuilds.
  const runtimeEntries = ['lib', 'prebuilds', 'package.json', 'LICENSE'];
  for (const entry of runtimeEntries) {
    const s = path.join(srcDir, entry);
    if (!fs.existsSync(s)) continue;
    const d = path.join(dstDir, entry);
    // Skip Windows debug-symbol files (.pdb) — only needed for crash debugging
    // against debug builds, not runtime. Saves ~44 MB across win32 prebuilds.
    fs.cpSync(s, d, {
      recursive: true,
      filter: (src) => !src.endsWith('.pdb'),
    });
  }
  // Re-apply executable bit on prebuilt spawn-helper binaries (cpSync drops
  // perm bits on some platforms / file systems).
  const prebuildsDir = path.join(dstDir, 'prebuilds');
  if (fs.existsSync(prebuildsDir)) {
    for (const entry of fs.readdirSync(prebuildsDir)) {
      const helper = path.join(prebuildsDir, entry, 'spawn-helper');
      if (fs.existsSync(helper)) {
        try {
          fs.chmodSync(helper, 0o755);
        } catch {
          // best effort
        }
      }
    }
  }
  console.log('✓ Copied node_modules/node-pty/ (runtime files) → dist/node_modules/node-pty/');
}

/**
 * Bundle hook scripts (TypeScript) to dist/hooks via esbuild.
 * Produces a self-contained CJS file with shebang for Claude Code to execute.
 */
function buildHooks() {
  const entry = path.join(
    __dirname,
    'server',
    'src',
    'providers',
    'hook',
    'claude',
    'hooks',
    'claude-hook.ts',
  );
  if (!fs.existsSync(entry)) return;
  require('esbuild').buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir: path.join(__dirname, 'dist', 'hooks'),
    banner: { js: '#!/usr/bin/env node' },
  });
  console.log('✓ Built hooks/ → dist/hooks/');
}

/**
 * Bundle the standalone daemon CLI to dist/bin/serve.js.
 *
 * Output is CJS so `node dist/bin/serve.js` works without a `"type": "module"`
 * field in package.json. `bin/serve.ts` is ESM source (it uses
 * `import.meta.url` to locate its own directory, and is loaded as ESM under
 * vitest), so `import.meta.url` is rewritten to a CJS-safe equivalent built from
 * `__filename`.
 *
 * `vscode` is deliberately NOT external here. It has no installable
 * implementation (VS Code injects it at runtime), so if a VS Code dependency
 * ever leaks back into the daemon's import graph, this build fails immediately
 * with the offending file — instead of producing a bundle that only crashes when
 * a user runs it. Shared modules reach the host through `src/hostBridge.ts`.
 */
function buildDaemon() {
  const entry = path.join(__dirname, 'bin', 'serve.ts');
  if (!fs.existsSync(entry)) return;
  require('esbuild').buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    outfile: path.join(__dirname, 'dist', 'bin', 'serve.js'),
    external: ['node-pty'],
    banner: {
      js: [
        '#!/usr/bin/env node',
        "const __px_import_meta_url = require('url').pathToFileURL(__filename).href;",
      ].join('\n'),
    },
    define: { 'import.meta.url': '__px_import_meta_url' },
  });
  fs.chmodSync(path.join(__dirname, 'dist', 'bin', 'serve.js'), 0o755);
  console.log('✓ Built bin/serve.ts → dist/bin/serve.js');
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode', 'node-pty'],
    logLevel: 'silent',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    // Copy assets, node-pty, and hooks after build
    copyAssets();
    copyNodePty();
    buildHooks();
    buildDaemon();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
