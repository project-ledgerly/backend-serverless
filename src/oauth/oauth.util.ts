import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { API_SCOPES } from '../auth/auth-context.js';

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_DAYS = 90;
export const CODE_TTL_SECONDS = 600;
export const AUTHORIZE_FORM_TTL_SECONDS = 900;

export const REFRESH_TOKEN_PREFIX = 'rt_';

/** What each scope lets the app do, in words the user reads on the consent page. */
export const SCOPE_LABELS: Record<string, string> = {
  read: 'See your accounts, plan, balances and transactions',
  'transactions:write': 'Add, change and delete transactions and transfers',
  'plan:write': 'Change your plan: sections, bills, goals and recurring income',
  'accounts:write': 'Add, rename and remove accounts',
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newSecret(prefix: string): string {
  return prefix + randomBytes(32).toString('base64url');
}

/** PKCE S256: BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CHALLENGE.test(challenge);
}

export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Redirect URIs must be https, or http on the loopback interface (local tools).
 * No fragments and no custom schemes, so a code can only go to a web address.
 */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

/** Keeps only scopes we know; each once. */
export function parseScopes(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const known = new Set<string>(API_SCOPES);
  return [...new Set(raw.split(/\s+/).filter((s) => known.has(s)))];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

/** Signs a small payload so the consent form can carry the request without storing it. */
export function signPayload(payload: Record<string, unknown>, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  const mac = createHmac('sha256', secret()).update(`oauth-form:${body}`).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: unknown, now = Date.now()): T | null {
  if (typeof token !== 'string') return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', secret()).update(`oauth-form:${body}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Public base URL of this API. API_URL wins; otherwise what the request says. */
export function issuerOf(req: Request): string {
  const configured = process.env.API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host;
  return `${proto}://${host}`;
}

/** Sliding window of failed sign-ins per key. In memory: a speed bump, not a guarantee, on serverless. */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  isBlocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear();
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }
}
