import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import { acceptUpgrade, type UpgradeContext } from '../wsServer.js';

const TOKEN = 'tok-123';

function fakeReq(headers: Record<string, string>, url = '/ws?token=tok-123'): http.IncomingMessage {
  return { headers, url } as unknown as http.IncomingMessage;
}

describe('acceptUpgrade', () => {
  const ctx: UpgradeContext = { allowedOrigins: ['http://127.0.0.1:39187'], token: TOKEN };

  it('accepts requests with matching origin and token', () => {
    const ok = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }), ctx);
    expect(ok).toEqual({ kind: 'accept' });
  });

  it('rejects on wrong origin', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://evil.example' }), ctx);
    expect(res).toEqual({ kind: 'reject', code: 403, reason: 'origin' });
  });

  it('rejects on missing token', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }, '/ws'), ctx);
    expect(res).toEqual({ kind: 'reject', code: 401, reason: 'token' });
  });

  it('rejects on wrong token', () => {
    const res = acceptUpgrade(fakeReq({ origin: 'http://127.0.0.1:39187' }, '/ws?token=nope'), ctx);
    expect(res).toEqual({ kind: 'reject', code: 401, reason: 'token' });
  });

  it('also accepts http://localhost:<port>', () => {
    const c2: UpgradeContext = {
      allowedOrigins: ['http://127.0.0.1:39187', 'http://localhost:39187'],
      token: TOKEN,
    };
    const ok = acceptUpgrade(fakeReq({ origin: 'http://localhost:39187' }), c2);
    expect(ok).toEqual({ kind: 'accept' });
  });
});
