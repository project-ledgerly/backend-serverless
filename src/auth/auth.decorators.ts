import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { AuthContext, AuthedRequest } from './auth-context.js';

export const IS_PUBLIC = 'isPublic';
/** Skips AuthGuard: for register, login and the health check only. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The caller resolved by AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});
