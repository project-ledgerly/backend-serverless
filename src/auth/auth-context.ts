import type { Request } from 'express';

/** Scopes an API token can carry. A login (JWT) has all of them. */
export const API_SCOPES = ['read', 'plan:write', 'transactions:write', 'accounts:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_TOKEN_PREFIX = 'ctr_';

/** Who is calling, resolved by AuthGuard and attached to the request. */
export interface AuthContext {
  userId: string;
  via: 'jwt' | 'token';
  scopes: readonly string[];
  tokenId?: string;
  /** Empty = no account restriction. */
  accountIds: readonly string[];
}

export type AuthedRequest = Request & { auth?: AuthContext };
