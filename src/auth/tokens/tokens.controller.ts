import { Body, Controller, Delete, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth-context.js';
import { CurrentAuth } from '../auth.decorators.js';
import { CreateTokenDto } from './dto/create-token.dto.js';
import { TokensService } from './tokens.service.js';

// Managing tokens needs a real login: a token can never mint or revoke tokens.
@ApiTags('tokens')
@ApiBearerAuth()
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  private requireLogin(auth: AuthContext) {
    if (auth.via !== 'jwt') throw new ForbiddenException('Sign in to manage tokens');
  }

  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTokenDto) {
    this.requireLogin(auth);
    return this.tokens.create(auth.userId, dto);
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    this.requireLogin(auth);
    return this.tokens.list(auth.userId);
  }

  @Delete(':id')
  revoke(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    this.requireLogin(auth);
    return this.tokens.revoke(auth.userId, id);
  }
}
