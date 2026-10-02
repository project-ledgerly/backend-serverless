import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { API_SCOPES, API_TOKEN_PREFIX } from '../auth/auth-context.js';
import { hashApiToken } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZE_FORM_TTL_SECONDS,
  CODE_TTL_SECONDS,
  FailureLimiter,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_DAYS,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  newSecret,
  parseScopes,
  sha256Hex,
  signPayload,
  verifyPayload,
  verifyPkce,
} from './oauth.util.js';

/** An error in the RFC 6749 shape: { error, error_description }. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface AuthorizeParams {
  /** OAuthClient.id */
  cid: string;
  clientName: string;
  ru: string;
  st?: string;
  cc: string;
  /** Scopes the app asked for (or all, when it did not say). */
  sc: string[];
  rs?: string;
}

export type AuthorizeCheck =
  | { kind: 'page'; message: string }
  | { kind: 'redirect'; redirectUri: string; state?: string; error: string; description: string }
  | { kind: 'ok'; params: AuthorizeParams };

type FormPayload = Record<string, unknown> & AuthorizeParams;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

@Injectable()
export class OAuthService {
  /** 8 wrong passwords per email and address in 15 minutes. */
  private readonly limiter = new FailureLimiter(8, 15 * 60_000);

  constructor(private readonly prisma: PrismaService) {}

  // --- registration (RFC 7591) -------------------------------------------------

  async register(body: Record<string, unknown>) {
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(isAllowedRedirectUri)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1 to 10 https URLs (http only for localhost)');
    }
    const name = (str(body.client_name) ?? 'Connected app').trim().slice(0, 80) || 'Connected app';
    const clientId = 'cli_' + randomBytes(16).toString('hex');
    const row = await this.prisma.oAuthClient.create({
      data: { clientId, name, redirectUris: [...new Set(uris as string[])] },
    });
    return {
      client_id: row.clientId,
      client_name: row.name,
      redirect_uris: row.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    };
  }

  // --- authorize ---------------------------------------------------------------

  /**
   * Checks an authorization request. Problems with the client or redirect URI
   * are shown on a page and never redirected (the URI cannot be trusted);
   * other problems go back to the app as an error redirect.
   */
  async checkAuthorize(q: Record<string, unknown>): Promise<AuthorizeCheck> {
    const clientId = str(q.client_id);
    const redirectUri = str(q.redirect_uri);
    if (!clientId) return { kind: 'page', message: 'The app did not say who it is (client_id is missing).' };
    const client = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    if (!client) return { kind: 'page', message: 'This app is not registered.' };
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return { kind: 'page', message: 'The return address does not match what the app registered.' };
    }

    const state = str(q.state);
    const fail = (error: string, description: string): AuthorizeCheck => ({ kind: 'redirect', redirectUri, state, error, description });

    if (q.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be "code"');
    if (!isValidCodeChallenge(q.code_challenge)) return fail('invalid_request', 'A PKCE code_challenge is required');
    if (q.code_challenge_method !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');

    const asked = parseScopes(q.scope);
    const resource = str(q.resource);
    return {
      kind: 'ok',
      params: {
        cid: client.id,
        clientName: client.name,
        ru: redirectUri,
        st: state,
        cc: q.code_challenge,
        sc: asked.length > 0 ? asked : [...API_SCOPES],
        rs: resource && resource.length <= 2000 ? resource : undefined,
      },
    };
  }

  signForm(params: AuthorizeParams): string {
    return signPayload(params as unknown as Record<string, unknown>, AUTHORIZE_FORM_TTL_SECONDS);
  }

  readForm(form: unknown): AuthorizeParams | null {
    const payload = verifyPayload<FormPayload>(form);
    if (!payload || typeof payload.cid !== 'string' || typeof payload.ru !== 'string' || typeof payload.cc !== 'string') return null;
    if (!Array.isArray(payload.sc)) return null;
    return {
      cid: payload.cid,
      clientName: String(payload.clientName ?? 'Connected app'),
      ru: payload.ru,
      st: typeof payload.st === 'string' ? payload.st : undefined,
      cc: payload.cc,
      sc: parseScopes(payload.sc.join(' ')),
      rs: typeof payload.rs === 'string' ? payload.rs : undefined,
    };
  }

  /** Verifies the password and issues a one-time code. Returns the URL to send the browser to. */
  async approve(params: AuthorizeParams, email: string, password: string, checked: string[], ip: string): Promise<string> {
    const key = `${ip}|${email.toLowerCase()}`;
    if (this.limiter.isBlocked(key)) {
      throw new OAuthError('access_denied', 'Too many attempts. Wait a few minutes and try again.', 429);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      this.limiter.fail(key);
      throw new OAuthError('access_denied', 'Invalid email or password', 401);
    }
    this.limiter.clear(key);

    // What was ticked, limited to what was offered. Reading is always part of it.
    const granted = new Set(checked.filter((s) => params.sc.includes(s)));
    granted.add('read');

    const code = newSecret('');
    await this.prisma.oAuthCode.create({
      data: {
        codeHash: sha256Hex(code),
        clientId: params.cid,
        userId: user.id,
        redirectUri: params.ru,
        codeChallenge: params.cc,
        scopes: API_SCOPES.filter((s) => granted.has(s)),
        resource: params.rs,
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      },
    });
    // Housekeeping, never worth failing a sign-in for.
    void this.prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } }).catch(() => {});

    return this.redirectUrl(params.ru, { code, state: params.st });
  }

  redirectUrl(base: string, query: Record<string, string | undefined>): string {
    const url = new URL(base);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
    return url.toString();
  }

  // --- token -------------------------------------------------------------------

  async token(body: Record<string, unknown>) {
    const grant = str(body.grant_type);
    if (grant === 'authorization_code') return this.exchangeCode(body);
    if (grant === 'refresh_token') return this.refresh(body);
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  }

  private async exchangeCode(body: Record<string, unknown>) {
    const code = str(body.code);
    const clientId = str(body.client_id);
    if (!code || !clientId) throw new OAuthError('invalid_request', 'code and client_id are required');

    const row = await this.prisma.oAuthCode.findUnique({ where: { codeHash: sha256Hex(code) }, include: { client: true } });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.client.clientId !== clientId) {
      throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used');
    }
    if (str(body.redirect_uri) !== row.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
    }

    // Burn the code before checking the verifier, so a wrong guess cannot be retried.
    const claimed = await this.prisma.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used');
    if (!verifyPkce(body.code_verifier, row.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'code_verifier does not match the code_challenge');
    }

    return this.issue({ userId: row.userId, clientRowId: row.clientId, clientName: row.client.name, scopes: row.scopes, resource: row.resource });
  }

  private async refresh(body: Record<string, unknown>) {
    const token = str(body.refresh_token);
    const clientId = str(body.client_id);
    if (!token || !clientId) throw new OAuthError('invalid_request', 'refresh_token and client_id are required');

    const row = await this.prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { client: true } });
    if (!row || row.client.clientId !== clientId || row.expiresAt.getTime() <= Date.now()) {
      throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired');
    }
    if (row.revokedAt) {
      // A used token coming back means a copy leaked: end this connection entirely.
      await this.revokeConnection(row.userId, row.clientId);
      throw new OAuthError('invalid_grant', 'The refresh token was already used; sign in again');
    }

    const claimed = await this.prisma.oAuthRefreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw new OAuthError('invalid_grant', 'The refresh token was already used; sign in again');
    if (row.apiTokenId) {
      await this.prisma.apiToken.updateMany({ where: { id: row.apiTokenId, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    return this.issue({ userId: row.userId, clientRowId: row.clientId, clientName: row.client.name, scopes: row.scopes, resource: row.resource });
  }

  private async issue(a: { userId: string; clientRowId: string; clientName: string; scopes: string[]; resource: string | null }) {
    const access = newSecret(API_TOKEN_PREFIX);
    const refresh = newSecret(REFRESH_TOKEN_PREFIX);
    const now = Date.now();

    const apiToken = await this.prisma.apiToken.create({
      data: {
        userId: a.userId,
        name: `${a.clientName} (sign-in)`.slice(0, 60),
        prefix: access.slice(0, 12),
        tokenHash: hashApiToken(access),
        scopes: a.scopes,
        accountIds: [],
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
    });
    await this.prisma.oAuthRefreshToken.create({
      data: {
        tokenHash: sha256Hex(refresh),
        clientId: a.clientRowId,
        userId: a.userId,
        scopes: a.scopes,
        resource: a.resource,
        apiTokenId: apiToken.id,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });

    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh,
      scope: a.scopes.join(' '),
    };
  }

  // --- revoke (RFC 7009) -------------------------------------------------------

  /** Always succeeds from the caller's point of view, as the RFC asks. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    const now = new Date();
    if (token.startsWith(REFRESH_TOKEN_PREFIX)) {
      const row = await this.prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
      if (!row) return;
      await this.prisma.oAuthRefreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
      if (row.apiTokenId) await this.prisma.apiToken.updateMany({ where: { id: row.apiTokenId, revokedAt: null }, data: { revokedAt: now } });
      return;
    }
    if (token.startsWith(API_TOKEN_PREFIX)) {
      const row = await this.prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(token) } });
      if (!row) return;
      await this.prisma.apiToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
      await this.prisma.oAuthRefreshToken.updateMany({ where: { apiTokenId: row.id, revokedAt: null }, data: { revokedAt: now } });
    }
  }

  private async revokeConnection(userId: string, clientRowId: string): Promise<void> {
    const now = new Date();
    const live = await this.prisma.oAuthRefreshToken.findMany({ where: { userId, clientId: clientRowId }, select: { id: true, apiTokenId: true } });
    await this.prisma.oAuthRefreshToken.updateMany({ where: { userId, clientId: clientRowId, revokedAt: null }, data: { revokedAt: now } });
    const apiIds = live.map((r) => r.apiTokenId).filter((id): id is string => !!id);
    if (apiIds.length > 0) await this.prisma.apiToken.updateMany({ where: { id: { in: apiIds }, revokedAt: null }, data: { revokedAt: now } });
  }
}
