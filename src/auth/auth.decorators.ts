import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { ApiScope, AuthContext, AuthedRequest } from './auth-context.js';

export const IS_PUBLIC = 'isPublic';
/** Skips AuthGuard: for register, login and the health check only. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_SCOPES = 'requiredScopes';
/** An API token must carry every listed scope to call this route. A login has them all. */
export const RequireScopes = (...scopes: ApiScope[]) => SetMetadata(REQUIRED_SCOPES, scopes);

/** The caller resolved by AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
