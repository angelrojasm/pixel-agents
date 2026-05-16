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
