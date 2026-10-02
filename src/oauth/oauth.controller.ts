import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { API_SCOPES } from '../auth/auth-context.js';
import { Public } from '../auth/auth.decorators.js';
import { authorizePage, errorPage } from './oauth.pages.js';
import { OAuthError, OAuthService } from './oauth.service.js';
import { issuerOf } from './oauth.util.js';

type Bag = Record<string, unknown>;

const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
} as const;

function clientIp(req: Request): string {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return forwarded || req.ip || 'unknown';
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}

/**
 * OAuth 2.1 for apps that connect to Centric on a user's behalf (ChatGPT,
 * Claude): discovery, dynamic client registration, a sign-in page, token
 * exchange with PKCE, refresh and revoke. It hands out the same ctr_ API
 * tokens as POST /tokens, so scopes and ownership checks are unchanged.
 */
@ApiExcludeController()
@Public()
@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('.well-known/oauth-authorization-server')
  metadata(@Req() req: Request) {
    const iss = issuerOf(req);
    return {
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      registration_endpoint: `${iss}/oauth/register`,
      revocation_endpoint: `${iss}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...API_SCOPES],
      authorization_response_iss_parameter_supported: true,
    };
  }

  @Post('oauth/register')
  async register(@Body() body: Bag, @Res() res: Response) {
    try {
      res.status(201).set('Cache-Control', 'no-store').json(await this.oauth.register(body ?? {}));
    } catch (e) {
      this.sendError(res, e);
    }
  }

  @Get('oauth/authorize')
  async authorize(@Query() query: Bag, @Req() req: Request, @Res() res: Response) {
    const check = await this.oauth.checkAuthorize(query);
    res.set(PAGE_HEADERS);
    if (check.kind === 'page') return res.status(400).type('html').send(errorPage(check.message));
    if (check.kind === 'redirect') {
      return res.redirect(
        302,
        this.oauth.redirectUrl(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: issuerOf(req) }),
      );
    }
    const { params } = check;
    return res.type('html').send(
      authorizePage({ clientName: params.clientName, form: this.oauth.signForm(params), offered: params.sc, action: '/oauth/authorize' }),
    );
  }

  @Post('oauth/authorize')
  async submit(@Body() body: Bag, @Req() req: Request, @Res() res: Response) {
    res.set(PAGE_HEADERS);
    const params = this.oauth.readForm(body?.form);
    if (!params) return res.status(400).type('html').send(errorPage('This sign-in page expired. Go back to the app and try connecting again.'));

    if (body.decision !== 'approve') {
      return res.redirect(
        303,
        this.oauth.redirectUrl(params.ru, { error: 'access_denied', error_description: 'The user did not allow access', state: params.st, iss: issuerOf(req) }),
      );
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const checked = asList(body.scope);
    try {
      if (!email || !password) throw new OAuthError('access_denied', 'Enter your email and password', 400);
      const url = await this.oauth.approve(params, email, password, checked, clientIp(req));
      const withIss = new URL(url);
      withIss.searchParams.set('iss', issuerOf(req));
      return res.redirect(303, withIss.toString());
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      return res
        .status(e.status)
        .type('html')
        .send(authorizePage({ clientName: params.clientName, form: String(body.form), offered: params.sc, checked, email, error: e.message, action: '/oauth/authorize' }));
    }
  }

  @Post('oauth/token')
  @HttpCode(200)
  async token(@Body() body: Bag, @Res() res: Response) {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try {
      res.json(await this.oauth.token(body ?? {}));
    } catch (e) {
      this.sendError(res, e);
    }
  }

  @Post('oauth/revoke')
  @HttpCode(200)
  async revoke(@Body() body: Bag, @Res() res: Response) {
    await this.oauth.revoke(typeof body?.token === 'string' ? body.token : undefined).catch(() => {});
    res.set('Cache-Control', 'no-store').json({});
  }

  private sendError(res: Response, e: unknown) {
    if (!(e instanceof OAuthError)) throw e;
    res.status(e.status).set('Cache-Control', 'no-store').json({ error: e.code, error_description: e.message });
  }
}
