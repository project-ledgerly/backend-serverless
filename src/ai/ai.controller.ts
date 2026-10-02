import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequireScopes } from '../auth/auth.decorators.js';
import { AccountLinkService } from './account-link.service.js';
import { BatchService } from './batch.service.js';
import { LinkAccountDto } from './dto/link-account.dto.js';
import { LogBatchDto } from './dto/log-batch.dto.js';
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
    private readonly batches: BatchService,
    private readonly accountLinks: AccountLinkService,
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

  /**
   * Logs many transactions and transfers in one atomic step and returns a
   * batchId that undoes all of it. Rows already in the account (same account,
   * day, amount and description) are skipped, so re-sending a statement is safe.
   * Send dryRun: true to see what would happen without writing anything.
   */
  @Post('transactions/batch')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes('transactions:write')
  logBatch(@CurrentAuth() auth: AuthContext, @Body() dto: LogBatchDto) {
    return this.batches.log(auth, dto);
  }

  /** The latest imports, newest first, with the ids that undo them. */
  @Get('batches')
  @RequireScopes('read')
  listBatches(@CurrentAuth() auth: AuthContext) {
    return this.batches.list(auth.userId);
  }

  /** Reverses an import: balances, goal totals and the rows it created. */
  @Post('batches/:batchId/undo')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('transactions:write')
  undoBatch(@CurrentAuth() auth: AuthContext, @Param('batchId') batchId: string) {
    return this.batches.undo(auth.userId, batchId);
  }

  /**
   * Remembers how the bank prints one of the user's accounts (its number, or
   * the last digits) so later statements are recognised without asking.
   */
  @Post('accounts/:accountId/identifiers')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('accounts:write')
  linkAccount(@CurrentAuth() auth: AuthContext, @Param('accountId') accountId: string, @Body() dto: LinkAccountDto) {
    return this.accountLinks.link(auth.userId, accountId, dto.identifier);
  }
}
