import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { API_SCOPES, type AuthedRequest } from '../auth-context.js';
import { AuthGuard, hashApiToken } from '../auth.guard.js';
import { OwnershipService } from '../ownership.service.js';

const ME = 'user-me';
const OTHER = 'user-other';

/** In-memory stand-in for the few Prisma calls the guard makes. */
function fakePrisma(opts: { accounts?: Record<string, string>; sections?: Record<string, string>; tokens?: any[] } = {}) {
  const accounts = opts.accounts ?? {};
  const sections = opts.sections ?? {};
  const tokens = opts.tokens ?? [];
  const none = { findUnique: async () => null };
  return {
    account: { findUnique: async ({ where }: any) => (accounts[where.id] ? { userId: accounts[where.id] } : null) },
    section: {
      findUnique: async ({ where }: any) => (sections[where.id] ? { plan: { userId: sections[where.id] } } : null),
    },
    plan: none,
    listing: none,
    income: none,
    goal: none,
    transaction: none,
    transfer: none,
    apiToken: {
      findUnique: async ({ where }: any) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      update: vi.fn(async () => ({})),
    },
  } as any;
}

function setup(prisma: any, jwtResult: any = { sub: ME }) {
  const jwt = {
    verifyAsync: vi.fn(async (t: string) => {
      if (t === 'bad') throw new Error('invalid');
      return jwtResult;
    }),
  } as any;
  const guard = new AuthGuard(new Reflector(), jwt, prisma, new OwnershipService(prisma));
  const run = (req: Partial<AuthedRequest>, isPublic = false) => {
    const handler = () => {};
    if (isPublic) Reflect.defineMetadata?.('isPublic', true, handler);
    // Filled in place, so a test can read `req.auth` back afterwards.
    const r: any = req;
    r.headers ??= {};
    r.params ??= {};
    r.query ??= {};
    r.body ??= {};
    r.path ??= '/x';
    const ctx = {
      switchToHttp: () => ({ getRequest: () => r }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  };
  return { run };
}

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

describe('AuthGuard with a login JWT', () => {
  it('rejects a request without a token', async () => {
    const { run } = setup(fakePrisma());
    await expect(run({})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a bad token', async () => {
    const { run } = setup(fakePrisma());
    await expect(run(bearer('bad'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets a valid token through and records who it is', async () => {
    const req: any = { ...bearer('good'), query: { userId: ME } };
    const { run } = setup(fakePrisma());
    await expect(run(req)).resolves.toBe(true);
    expect(req.auth).toMatchObject({ userId: ME, via: 'jwt', scopes: API_SCOPES });
  });

  it('refuses another user id in the query, body or path as not found', async () => {
    const { run } = setup(fakePrisma());
    await expect(run({ ...bearer('good'), query: { userId: OTHER } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run({ ...bearer('good'), body: { userId: OTHER } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run({ ...bearer('good'), params: { userId: OTHER } })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses ids that belong to someone else, but not ones that do not exist', async () => {
    const prisma = fakePrisma({ accounts: { mine: ME, theirs: OTHER }, sections: { s1: ME, s2: OTHER } });
    const { run } = setup(prisma);
    await expect(run({ ...bearer('good'), params: { accountId: 'mine' } })).resolves.toBe(true);
    await expect(run({ ...bearer('good'), params: { accountId: 'theirs' } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run({ ...bearer('good'), params: { accountId: 'missing' } })).resolves.toBe(true);
    await expect(run({ ...bearer('good'), body: { fromAccountId: 'mine', toAccountId: 'theirs' } })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(run({ ...bearer('good'), body: { orderedSectionIds: ['s1', 's2'] } })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AuthGuard with an API token', () => {
  const secret = 'ctr_abc123';
  const row = (over: object = {}) => ({
    id: 't1',
    userId: ME,
    tokenHash: hashApiToken(secret),
    scopes: ['read'],
    accountIds: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...over,
  });

  it('works on /ai routes', async () => {
    const req: any = { ...bearer(secret), path: '/ai/whoami' };
    const { run } = setup(fakePrisma({ tokens: [row()] }));
    await expect(run(req)).resolves.toBe(true);
    expect(req.auth).toMatchObject({ userId: ME, via: 'token', scopes: ['read'], tokenId: 't1' });
  });

  it('is refused on the regular API', async () => {
    const { run } = setup(fakePrisma({ tokens: [row()] }));
    await expect(run({ ...bearer(secret), path: '/accounts' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run({ ...bearer(secret), path: '/tokens' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is refused when unknown, revoked or expired', async () => {
    const path = '/ai/whoami';
    await expect(setup(fakePrisma()).run({ ...bearer(secret), path })).rejects.toBeInstanceOf(UnauthorizedException);
    const revoked = fakePrisma({ tokens: [row({ revokedAt: new Date() })] });
    await expect(setup(revoked).run({ ...bearer(secret), path })).rejects.toBeInstanceOf(UnauthorizedException);
    const expired = fakePrisma({ tokens: [row({ expiresAt: new Date(Date.now() - 1000) })] });
    await expect(setup(expired).run({ ...bearer(secret), path })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('can only name the accounts it was limited to', async () => {
    const prisma = fakePrisma({ accounts: { a1: ME, a2: ME }, tokens: [row({ accountIds: ['a1'] })] });
    const { run } = setup(prisma);
    const base = { ...bearer(secret), path: '/ai/x' };
    await expect(run({ ...base, body: { accountId: 'a1' } })).resolves.toBe(true);
    await expect(run({ ...base, body: { accountId: 'a2' } })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
