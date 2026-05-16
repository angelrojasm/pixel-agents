import type * as http from 'node:http';

export interface UpgradeContext {
  allowedOrigins: string[];
  token: string;
}

export type UpgradeDecision =
  | { kind: 'accept' }
  | { kind: 'reject'; code: 401 | 403; reason: 'origin' | 'token' };

export function acceptUpgrade(req: http.IncomingMessage, ctx: UpgradeContext): UpgradeDecision {
  const origin = req.headers.origin ?? '';
  if (!ctx.allowedOrigins.includes(origin)) {
    return { kind: 'reject', code: 403, reason: 'origin' };
  }
  const url = new URL(req.url ?? '/', 'http://x');
  const token = url.searchParams.get('token') ?? '';
  if (token !== ctx.token) {
    return { kind: 'reject', code: 401, reason: 'token' };
  }
  return { kind: 'accept' };
}
