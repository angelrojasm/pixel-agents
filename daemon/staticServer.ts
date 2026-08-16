import * as fs from 'node:fs';
import * as path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export interface StaticResult {
  body: Buffer;
  contentType: string;
}

/**
 * Resolve the build output directory (`dist/`) from the directory of the running
 * entrypoint. There are exactly two layouts to support:
 *
 *   - bundled: `dist/bin/serve.js`  → `..`        = `dist/`
 *   - source:  `bin/serve.ts` (tsx) → `../dist`   = `dist/`
 *
 * A candidate only wins if it carries a real build artifact (`webview/index.html`
 * from vite, or `hooks/claude-hook.js` from esbuild), so an empty same-named
 * directory can't shadow the real one. Falls back to the bundled candidate so the
 * caller gets a stable path when nothing is built yet.
 *
 * Deliberately does NOT consult `process.cwd()` — the daemon must resolve the same
 * files no matter which directory it was launched from.
 */
export function resolveDistRoot(entryDir: string): string {
  const candidates = [path.join(entryDir, '..'), path.join(entryDir, '..', 'dist')];
  const isDistRoot = (dir: string): boolean =>
    fs.existsSync(path.join(dir, 'webview', 'index.html')) ||
    fs.existsSync(path.join(dir, 'hooks', 'claude-hook.js'));
  return candidates.find(isDistRoot) ?? candidates[0];
}

/**
 * Resolve the built SPA directory served at `/`. Vite writes it to `dist/webview`
 * (`webview-ui/vite.config.ts` → `build.outDir`).
 */
export function resolveSpaRoot(entryDir: string): string {
  return path.join(resolveDistRoot(entryDir), 'webview');
}

/**
 * Serve a static file from a root directory. Returns null when the file is
 * missing or the URL escapes the root (path-traversal guard).
 *
 * The caller is responsible for 404 handling when null is returned.
 */
export function serveStaticFile(opts: { root: string; urlPath: string }): StaticResult | null {
  const cleanUrl = (opts.urlPath.split('?')[0] || '/').replace(/\\/g, '/');
  const target = cleanUrl === '/' ? '/index.html' : cleanUrl;
  const safeRoot = path.resolve(opts.root);
  // path.resolve handles `..` segments. Anchoring on safeRoot + '.' + target
  // means any escape attempt resolves to a path that does NOT start with
  // safeRoot + sep — the guard below catches it.
  const filePath = path.resolve(safeRoot, '.' + target);
  if (filePath !== safeRoot && !filePath.startsWith(safeRoot + path.sep)) {
    return null;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  return { body: fs.readFileSync(filePath), contentType: MIME[ext] ?? 'application/octet-stream' };
}

/**
 * Inject a `<meta name="px-token">` tag at the start of `<head>` in the given
 * HTML string. The token allows the SPA's WS client to authenticate its upgrade
 * request without needing a separate API call.
 *
 * Case-insensitive on `<head>` in case build tools output `<HEAD>`.
 */
export function injectMetaTag(html: string, token: string): string {
  return html.replace(/<head>/i, `<head><meta name="px-token" content="${token}">`);
}
