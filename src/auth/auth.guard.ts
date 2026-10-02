import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { API_SCOPES, API_TOKEN_PREFIX, type AuthContext, type AuthedRequest } from './auth-context.js';
import { IS_PUBLIC, REQUIRED_SCOPES } from './auth.decorators.js';
import { OwnershipService } from './ownership.service.js';

const TOUCH_AFTER_MS = 60_000;

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Runs on every route unless it is marked @Public(). Resolves who is calling
 * from a login JWT or an API token, then checks everything the request names
 * belongs to them.
 *
 * - A login JWT can use every route.
 * - An API token can only use /ai/*, and only what its scopes and account
 *   list allow. It can never create tokens or touch the regular API.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const auth = token.startsWith(API_TOKEN_PREFIX) ? await this.fromApiToken(token, req) : await this.fromJwt(token);
    req.auth = auth;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const missing = required?.filter((scope) => !auth.scopes.includes(scope));
    if (missing && missing.length > 0) {
      throw new ForbiddenException(`This token is missing the ${missing.join(', ')} scope`);
    }

    await this.ownership.assertOwned(req, auth);
    return true;
  }

  private async fromJwt(token: string): Promise<AuthContext> {
    let payload: { sub?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.sub) throw new UnauthorizedException('Invalid token');
    return { userId: payload.sub, via: 'jwt', scopes: API_SCOPES, accountIds: [] };
  }

  private async fromApiToken(token: string, req: AuthedRequest): Promise<AuthContext> {
    const path = req.path;
    if (path !== '/ai' && !path.startsWith('/ai/')) {
      throw new ForbiddenException('API tokens can only be used on /ai routes');
    }

    const row = await this.prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(token) } });
    const now = Date.now();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now)) {
      throw new UnauthorizedException('Invalid, expired or revoked token');
    }

    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
      // Best effort: a failed bookkeeping write must not fail the request.
      void this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {});
    }
    return { userId: row.userId, via: 'token', scopes: row.scopes, tokenId: row.id, accountIds: row.accountIds };
  }
}
