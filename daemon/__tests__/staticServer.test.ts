import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { serveStaticFile, injectMetaTag } from '../staticServer.js';

describe('serveStaticFile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-static-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><head><title>px</title></head>');
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.writeFileSync(path.join(tmp, 'assets', 'app.js'), 'console.log(1)');

  it('serves index.html for /', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/' });
    expect(result?.contentType).toBe('text/html');
    expect(String(result?.body)).toContain('<!doctype html>');
  });
  it('serves assets/app.js with application/javascript', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/assets/app.js' });
    expect(result?.contentType).toBe('application/javascript');
  });
  it('returns null for missing files (caller falls through to 404)', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/nope.txt' });
    expect(result).toBeNull();
  });
  it('rejects path traversal attempts', () => {
    const result = serveStaticFile({ root: tmp, urlPath: '/../../../etc/passwd' });
    expect(result).toBeNull();
  });
});

describe('injectMetaTag', () => {
  it('injects px-token meta tag into index.html after <head>', () => {
    const html = '<!doctype html><html><head><title>px</title></head><body></body></html>';
    const token = 'test-token-abc';
    const result = injectMetaTag(html, token);
    expect(result).toContain(`<meta name="px-token" content="${token}">`);
    expect(result).toContain('<head><meta name="px-token"');
    // rest of content preserved
    expect(result).toContain('<title>px</title>');
  });
});
