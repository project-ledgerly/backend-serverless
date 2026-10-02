import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext, AuthedRequest } from './auth-context.js';

type Kind = 'account' | 'plan' | 'section' | 'listing' | 'income' | 'goal' | 'transaction' | 'transfer' | 'batch';

/** Request fields that carry the id of something a user owns. */
const ID_FIELDS: Record<string, Kind> = {
  accountId: 'account',
  fromAccountId: 'account',
  toAccountId: 'account',
  planId: 'plan',
  sectionId: 'section',
  goalSectionId: 'section',
  orderedSectionIds: 'section',
  listingId: 'listing',
  incomeId: 'income',
  goalId: 'goal',
  transactionId: 'transaction',
  transferId: 'transfer',
  batchId: 'batch',
};

/**
 * Makes sure a request only touches things its caller owns. Services mostly
 * trust the ids they are handed, so this is the one place that checks every
 * `userId` and every id in the path, query and body against the caller.
 *
 * Something that belongs to someone else answers 404, the same as something
 * that does not exist, so ids can't be probed. Something that does not exist
 * is left for the handler to report.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOwned(req: AuthedRequest, auth: AuthContext): Promise<void> {
    const sources = [req.params, req.query, req.body] as Array<Record<string, unknown> | undefined>;
    const checks: Array<Promise<void>> = [];
    const seen = new Set<string>();

    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      if ('userId' in source && source.userId !== undefined && source.userId !== auth.userId) {
        throw new NotFoundException();
      }

      for (const [field, kind] of Object.entries(ID_FIELDS)) {
        const raw = source[field];
        const ids = Array.isArray(raw) ? raw : [raw];
        for (const id of ids) {
          if (typeof id !== 'string' || id === '') continue;
          const key = `${kind}:${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          checks.push(this.check(kind, id, auth));
        }
      }
    }
    await Promise.all(checks);
  }

  private async check(kind: Kind, id: string, auth: AuthContext): Promise<void> {
    // A token limited to some accounts can't name any other account.
    if (kind === 'account' && auth.accountIds.length > 0 && !auth.accountIds.includes(id)) {
      throw new ForbiddenException('This token is not allowed to use that account');
    }
    const owner = await this.ownerOf(kind, id);
    if (owner !== undefined && owner !== auth.userId) throw new NotFoundException();
  }

  /** The owning user's id, or undefined when the thing does not exist. */
  private async ownerOf(kind: Kind, id: string): Promise<string | undefined> {
    const p = this.prisma;
    switch (kind) {
      case 'account':
        return (await p.account.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'plan':
        return (await p.plan.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'section':
        return (await p.section.findUnique({ where: { id }, select: { plan: { select: { userId: true } } } }))?.plan
          .userId;
      case 'listing':
        return (await p.listing.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'income':
        return (await p.income.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'goal':
        return (
          await p.goal.findUnique({
            where: { id },
            select: { section: { select: { plan: { select: { userId: true } } } } },
          })
        )?.section.plan.userId;
      case 'transaction':
        return (await p.transaction.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'transfer':
        return (await p.transfer.findUnique({ where: { id }, select: { userId: true } }))?.userId;
      case 'batch':
        return (await p.batch.findUnique({ where: { id }, select: { userId: true } }))?.userId;
    }
  }
}
