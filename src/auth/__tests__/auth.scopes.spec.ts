import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RequireScopes } from '../auth.decorators.js';
import { AuthGuard, hashApiToken } from '../auth.guard.js';
import { OwnershipService } from '../ownership.service.js';

const secret = 'ctr_scopes';

function guardFor(scopes: string[]) {
  const prisma: any = {
    apiToken: {
      findUnique: async () => ({
        id: 't1',
        userId: 'u1',
        tokenHash: hashApiToken(secret),
        scopes,
        accountIds: [],
        lastUsedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      }),
      update: vi.fn(),
    },
  };
  return new AuthGuard(new Reflector(), {} as any, prisma, new OwnershipService(prisma));
}

class Controller {
  @RequireScopes('read')
  readOnly() {}
  @RequireScopes('read', 'transactions:write')
  writes() {}
  open() {}
}

function ctx(handler: () => void): ExecutionContext {
  const req = { headers: { authorization: `Bearer ${secret}` }, params: {}, query: {}, body: {}, path: '/ai/x' };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

describe('RequireScopes', () => {
  const c = new Controller();

  it('lets a token with the scope through', async () => {
    await expect(guardFor(['read']).canActivate(ctx(c.readOnly))).resolves.toBe(true);
  });

  it('refuses a token without it, naming what is missing', async () => {
    await expect(guardFor(['read']).canActivate(ctx(c.writes))).rejects.toThrow('transactions:write');
    await expect(guardFor(['transactions:write']).canActivate(ctx(c.readOnly))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('needs every listed scope', async () => {
    await expect(guardFor(['read', 'transactions:write']).canActivate(ctx(c.writes))).resolves.toBe(true);
  });

  it('does not ask for scopes on a route that declares none', async () => {
    await expect(guardFor([]).canActivate(ctx(c.open))).resolves.toBe(true);
  });
});
