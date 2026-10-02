import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequireScopes } from '../auth/auth.decorators.js';
import { SnapshotService } from './snapshot.service.js';

// Everything an AI tool (the MCP server) may call lives under /ai. API tokens
// are refused anywhere else.
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
  ) {}

  /** Who the token belongs to and what it may do. The MCP calls this first. */
  @Get('whoami')
  async whoami(@CurrentAuth() auth: AuthContext) {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, currency: true },
    });
    return { user, via: auth.via, scopes: auth.scopes, accountIds: auth.accountIds };
  }

  /**
   * Everything an AI needs to talk about the user's money: accounts and
   * balances, the plan with its sections, bills and goals, this month's
   * spending, and the latest transactions.
   */
  @Get('snapshot')
  @RequireScopes('read')
  snapshot(@CurrentAuth() auth: AuthContext) {
    return this.snapshots.forUser(auth);
  }
}
