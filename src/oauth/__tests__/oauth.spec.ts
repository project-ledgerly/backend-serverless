import * as bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { OAuthError, OAuthService } from '../oauth.service.js';
import {
  FailureLimiter,
  isAllowedRedirectUri,
  parseScopes,
  pkceChallenge,
  signPayload,
  verifyPayload,
  verifyPkce,
} from '../oauth.util.js';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = pkceChallenge(VERIFIER);
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

describe('oauth helpers', () => {
  it('matches the RFC 7636 PKCE example', () => {
    expect(pkceChallenge(VERIFIER)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifyPkce(VERIFIER + 'x', CHALLENGE)).toBe(false);
    expect(verifyPkce('short', CHALLENGE)).toBe(false);
    expect(verifyPkce(undefined, CHALLENGE)).toBe(false);
  });

  it('only accepts https, or http on loopback, without fragments or credentials', () => {
    for (const ok of [REDIRECT, 'http://localhost:6274/cb', 'http://127.0.0.1/cb', 'https://claude.ai/api/mcp/auth_callback']) {
      expect(isAllowedRedirectUri(ok), ok).toBe(true);
    }
    for (const bad of ['http://evil.com/cb', 'javascript:alert(1)', 'myapp://cb', 'https://a.com/cb#x', 'https://u:p@a.com/cb', '', 'nope', 5]) {
      expect(isAllowedRedirectUri(bad), String(bad)).toBe(false);
    }
  });

  it('keeps only known scopes, once', () => {
    expect(parseScopes('read plan:write read bogus')).toEqual(['read', 'plan:write']);
    expect(parseScopes(undefined)).toEqual([]);
  });

  it('signed form data survives a round trip, but not tampering or age', () => {
    const t = signPayload({ a: 1 }, 60, 1_000_000);
    expect(verifyPayload(t, 1_000_000)).toMatchObject({ a: 1 });
    expect(verifyPayload(t, 1_000_000 + 61_000)).toBeNull();
    const [body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ a: 2, exp: 9_999_999_999 })).toString('base64url');
    expect(verifyPayload(`${forged}.${mac}`, 1_000_000)).toBeNull();
    expect(verifyPayload(`${body}.${mac}x`, 1_000_000)).toBeNull();
    expect(verifyPayload(undefined)).toBeNull();
  });

  it('blocks after too many failures, and forgets them with time', () => {
    const l = new FailureLimiter(3, 1000);
    for (let i = 0; i < 3; i++) l.fail('k', 0);
    expect(l.isBlocked('k', 500)).toBe(true);
    expect(l.isBlocked('k', 1500)).toBe(false);
    expect(l.isBlocked('other', 0)).toBe(false);
  });
});

/** Just enough of Prisma, in memory, for the OAuth flows. */
function fakePrisma() {
  let n = 0;
  const id = () => `id-${++n}`;
  const t = { clients: [] as any[], codes: [] as any[], refresh: [] as any[], tokens: [] as any[], users: [] as any[] };
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
      if (v && typeof v === 'object' && 'lt' in (v as any)) return row[k] < (v as any).lt;
      return row[k] === v;
    });
  const table = (rows: any[], extra: (r: any, args: any) => any = (r) => r) => ({
    create: async ({ data }: any) => {
      const row = { id: id(), createdAt: new Date(), usedAt: null, revokedAt: null, lastUsedAt: null, ...data };
      rows.push(row);
      return row;
    },
    findUnique: async (args: any) => {
      const row = rows.find((r) => match(r, args.where));
      return row ? extra(row, args) : null;
    },
    findMany: async ({ where }: any) => rows.filter((r) => match(r, where)),
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async () => ({ count: 0 }),
  });
  const prisma = {
    oAuthClient: table(t.clients),
    oAuthCode: table(t.codes, (r, a) => (a.include?.client ? { ...r, client: t.clients.find((c) => c.id === r.clientId) } : r)),
    oAuthRefreshToken: table(t.refresh, (r, a) => (a.include?.client ? { ...r, client: t.clients.find((c) => c.id === r.clientId) } : r)),
    apiToken: table(t.tokens),
    user: table(t.users),
  } as any;
  return { prisma, t };
}

describe('oauth flow', () => {
  let svc: OAuthService;
  let t: ReturnType<typeof fakePrisma>['t'];
  let clientId: string;

  const authorizeQuery = () => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'read transactions:write',
    state: 'xyz',
  });

  async function signIn(checked = ['read', 'transactions:write']) {
    const check = await svc.checkAuthorize(authorizeQuery());
    if (check.kind !== 'ok') throw new Error('expected ok');
    const form = svc.signForm(check.params);
    const params = svc.readForm(form)!;
    const url = new URL(await svc.approve(params, 'me@test.com', 'Passw0rd!1', checked, '1.2.3.4'));
    return { url, code: url.searchParams.get('code')! };
  }

  const exchange = (code: string, over: Record<string, unknown> = {}) =>
    svc.token({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER, ...over });

  beforeEach(async () => {
    const f = fakePrisma();
    t = f.t;
    svc = new OAuthService(f.prisma);
    t.users.push({ id: 'u1', email: 'me@test.com', passwordHash: await bcrypt.hash('Passw0rd!1', 4) });
    const reg = await svc.register({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] });
    clientId = reg.client_id;
  });

  it('registers a public client and rejects bad redirect URIs', async () => {
    expect(clientId).toMatch(/^cli_/);
    await expect(svc.register({ redirect_uris: ['http://evil.com/cb'] })).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(svc.register({})).rejects.toBeInstanceOf(OAuthError);
  });

  it('shows an error page, never a redirect, for an unknown client or a redirect URI that was not registered', async () => {
    expect(await svc.checkAuthorize({ ...authorizeQuery(), client_id: 'nope' })).toMatchObject({ kind: 'page' });
    expect(await svc.checkAuthorize({ ...authorizeQuery(), redirect_uri: 'https://evil.com/cb' })).toMatchObject({ kind: 'page' });
    expect(await svc.checkAuthorize({ ...authorizeQuery(), redirect_uri: undefined })).toMatchObject({ kind: 'page' });
  });

  it('sends other request problems back to the app as an error', async () => {
    expect(await svc.checkAuthorize({ ...authorizeQuery(), code_challenge: undefined })).toMatchObject({ kind: 'redirect', error: 'invalid_request' });
    expect(await svc.checkAuthorize({ ...authorizeQuery(), code_challenge_method: 'plain' })).toMatchObject({ kind: 'redirect', error: 'invalid_request' });
    expect(await svc.checkAuthorize({ ...authorizeQuery(), response_type: 'token' })).toMatchObject({ kind: 'redirect', error: 'unsupported_response_type' });
  });

  it('offers every scope when the app does not ask for any', async () => {
    const check: any = await svc.checkAuthorize({ ...authorizeQuery(), scope: undefined });
    expect(check.params.sc).toEqual(['read', 'plan:write', 'transactions:write', 'accounts:write']);
  });

  it('signs in, returns the state, and trades the code for tokens', async () => {
    const { url, code } = await signIn();
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('xyz');
    const out: any = await exchange(code);
    expect(out.token_type).toBe('Bearer');
    expect(out.access_token).toMatch(/^ctr_/);
    expect(out.refresh_token).toMatch(/^rt_/);
    expect(out.expires_in).toBe(3600);
    expect(out.scope).toBe('read transactions:write');
    expect(t.tokens[0]).toMatchObject({ userId: 'u1', accountIds: [] });
    expect(t.tokens[0].tokenHash).not.toBe(out.access_token);
  });

  it('grants only what was ticked, always including read, and never more than was offered', async () => {
    const { code } = await signIn(['plan:write', 'accounts:write']);
    const out: any = await exchange(code);
    expect(out.scope).toBe('read');
  });

  it('refuses a wrong password, and locks out after repeated failures', async () => {
    const check: any = await svc.checkAuthorize(authorizeQuery());
    for (let i = 0; i < 8; i++) {
      await expect(svc.approve(check.params, 'me@test.com', 'wrong', [], '9.9.9.9')).rejects.toMatchObject({ status: 401 });
    }
    await expect(svc.approve(check.params, 'me@test.com', 'Passw0rd!1', [], '9.9.9.9')).rejects.toMatchObject({ status: 429 });
    await expect(svc.approve(check.params, 'me@test.com', 'Passw0rd!1', [], '8.8.8.8')).resolves.toContain('code=');
  });

  it('accepts a code once only', async () => {
    const { code } = await signIn();
    await exchange(code);
    await expect(exchange(code)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects a wrong verifier and burns the code', async () => {
    const { code } = await signIn();
    await expect(exchange(code, { code_verifier: 'A'.repeat(50) })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchange(code)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects a code used with another redirect URI, another client, or after expiry', async () => {
    const a = await signIn();
    await expect(exchange(a.code, { redirect_uri: 'https://evil.com/cb' })).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchange(a.code, { client_id: 'cli_other' })).rejects.toMatchObject({ code: 'invalid_grant' });
    t.codes[0].expiresAt = new Date(Date.now() - 1000);
    await expect(exchange(a.code)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rotates the refresh token and revokes the old access token', async () => {
    const first: any = await exchange((await signIn()).code);
    const second: any = await svc.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(t.tokens[0].revokedAt).toBeTruthy();
    expect(t.tokens[1].revokedAt).toBeNull();
  });

  it('ends the whole connection when an old refresh token is replayed', async () => {
    const first: any = await exchange((await signIn()).code);
    const second: any = await svc.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId });
    await expect(svc.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    expect(t.tokens.every((x) => x.revokedAt)).toBe(true);
    await expect(svc.token({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: clientId })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('refuses a refresh token from another client or an unknown grant type', async () => {
    const first: any = await exchange((await signIn()).code);
    await expect(svc.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'cli_other' })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    await expect(svc.token({ grant_type: 'password' })).rejects.toMatchObject({ code: 'unsupported_grant_type' });
  });

  it('revokes by refresh token or by access token', async () => {
    const a: any = await exchange((await signIn()).code);
    await svc.revoke(a.refresh_token);
    expect(t.refresh[0].revokedAt).toBeTruthy();
    expect(t.tokens[0].revokedAt).toBeTruthy();

    const b: any = await exchange((await signIn()).code);
    await svc.revoke(b.access_token);
    expect(t.tokens[1].revokedAt).toBeTruthy();
    expect(t.refresh[1].revokedAt).toBeTruthy();
    await expect(svc.revoke('garbage')).resolves.toBeUndefined();
  });
});
