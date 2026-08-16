import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  serveStaticFile,
  injectMetaTag,
  resolveSpaRoot,
  resolveDistRoot,
} from '../staticServer.js';

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

describe('resolveSpaRoot', () => {
  /** Build a fake repo/install tree with the SPA at dist/webview (vite's outDir). */
  function makeTree(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-spa-'));
    const spa = path.join(root, 'dist', 'webview');
    fs.mkdirSync(spa, { recursive: true });
    fs.writeFileSync(path.join(spa, 'index.html'), '<!doctype html><head></head>');
    return root;
  }

  it('resolves dist/webview when running from the bundled dist/bin/ layout', () => {
    const root = makeTree();
    expect(resolveSpaRoot(path.join(root, 'dist', 'bin'))).toBe(path.join(root, 'dist', 'webview'));
  });

  it('resolves dist/webview when running from source via tsx (bin/ layout)', () => {
    const root = makeTree();
    expect(resolveSpaRoot(path.join(root, 'bin'))).toBe(path.join(root, 'dist', 'webview'));
  });

  it('does not depend on process.cwd()', () => {
    const root = makeTree();
    const fromCwdA = resolveSpaRoot(path.join(root, 'dist', 'bin'));
    const spy = vi.spyOn(process, 'cwd').mockReturnValue('/some/unrelated/place');
    const fromCwdB = resolveSpaRoot(path.join(root, 'dist', 'bin'));
    spy.mockRestore();
    expect(fromCwdB).toBe(fromCwdA);
  });

  it('ignores a sibling directory that has no index.html', () => {
    const root = makeTree();
    // A stray dist/bin/../webview with no index.html must not win over the real SPA.
    fs.mkdirSync(path.join(root, 'webview'), { recursive: true });
    expect(resolveSpaRoot(path.join(root, 'bin'))).toBe(path.join(root, 'dist', 'webview'));
  });

  it('falls back to the bundled-layout candidate when no SPA build exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-spa-empty-'));
    expect(resolveSpaRoot(path.join(root, 'dist', 'bin'))).toBe(path.join(root, 'dist', 'webview'));
  });
});

describe('resolveDistRoot', () => {
  function makeTree(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-dist-'));
    const spa = path.join(root, 'dist', 'webview');
    fs.mkdirSync(spa, { recursive: true });
    fs.writeFileSync(path.join(spa, 'index.html'), '<!doctype html><head></head>');
    return root;
  }

  it('resolves dist/ from the bundled dist/bin/ layout', () => {
    const root = makeTree();
    expect(resolveDistRoot(path.join(root, 'dist', 'bin'))).toBe(path.join(root, 'dist'));
  });

  it('resolves dist/ from the source bin/ layout', () => {
    const root = makeTree();
    expect(resolveDistRoot(path.join(root, 'bin'))).toBe(path.join(root, 'dist'));
  });

  it('recognises a dist root by its bundled hook script alone', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-dist-hooks-'));
    const hooks = path.join(root, 'dist', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'claude-hook.js'), '#!/usr/bin/env node\n');
    expect(resolveDistRoot(path.join(root, 'bin'))).toBe(path.join(root, 'dist'));
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
