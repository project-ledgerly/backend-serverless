import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { movesBalance } from '../accounts/balance-rule.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { UpdateTransactionDto } from './dto/update-transaction.dto.js';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertAccountOwnedByUser(accountId: string, userId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) {
      throw new BadRequestException(`accountId ${accountId} is not an account of user ${userId}`);
    }
    return account;
  }

  /** The account-balance update an entry causes, or nothing when it is dated before the balance was stated. */
  private balanceOp(account: { id: string; balanceAsOf: Date | null }, date: Date, amount: Prisma.Decimal.Value, sign: 1 | -1) {
    if (!movesBalance(account.balanceAsOf, date)) return [];
    return [
      this.prisma.account.update({
        where: { id: account.id },
        data: { balance: sign === 1 ? { increment: amount } : { decrement: amount } },
      }),
    ];
  }

  private async loadSectionAndCheckProtection(sectionId: string, confirmed: boolean | undefined) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { goal: true } });
    if (!section) {
      throw new BadRequestException(`sectionId ${sectionId} does not exist`);
    }
    if (section.protected && !confirmed) {
      throw new BadRequestException({
        issues: [
          {
            rule: 4,
            message: `Section "${section.name}" is protected — spending from it requires explicit confirmation (confirmed: true)`,
          },
        ],
      });
    }
    return section;
  }

  /**
   * A Transaction tagged to a section that has a linked Goal is a
   * contribution (positive) or a withdrawal (negative) against that Goal,
   * same signed-amount convention as Account.balance — a savings
   * withdrawal deducts from what was already committed, per spec.
   */
  private goalDeltaOp(goal: { id: string; mode: string } | null | undefined, amount: Prisma.Decimal.Value) {
    // A RESERVE goal watches an account balance; it has no running total.
    if (!goal || goal.mode === 'RESERVE') return [];
    return [this.prisma.goal.update({ where: { id: goal.id }, data: { currentAmount: { increment: amount } } })];
  }

  private async assertListingFits(listingId: string, sectionId: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.userId !== userId) {
      throw new BadRequestException(`listingId ${listingId} is not a bill of user ${userId}`);
    }
    if (listing.sectionId !== sectionId) {
      throw new BadRequestException(`"${listing.name}" belongs to a different section than this expense`);
    }
  }

  async create(dto: CreateTransactionDto) {
    const account = await this.assertAccountOwnedByUser(dto.accountId, dto.userId);
    const section = await this.loadSectionAndCheckProtection(dto.sectionId, dto.confirmed);
    if (dto.listingId) await this.assertListingFits(dto.listingId, dto.sectionId, dto.userId);

    // amount is signed (see schema.prisma) — it's the source of truth the
    // account's balance (and the section's Goal, if any) are derived from.
    const [transaction] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          userId: dto.userId,
          accountId: dto.accountId,
          sectionId: dto.sectionId,
          amount: dto.amount,
          description: dto.description,
          date: new Date(dto.date),
          source: dto.source,
          listingId: dto.listingId,
        },
      }),
      // Dated before the balance was stated: it is already in that figure.
      ...this.balanceOp(account, new Date(dto.date), dto.amount, 1),
      ...this.goalDeltaOp(section.goal, dto.amount),
    ]);
    return transaction;
  }

  findAllForAccount(accountId: string) {
    return this.prisma.transaction.findMany({ where: { accountId }, orderBy: { date: 'desc' } });
  }

  findAllForSection(sectionId: string) {
    return this.prisma.transaction.findMany({ where: { sectionId }, orderBy: { date: 'desc' } });
  }

  /**
   * Newest first. `from` (inclusive) bounds the window — the Dashboard's
   * monthly spending chart asks for ~6 months back — and `limit` caps the
   * row count (default 50, max 1000) so an unbounded history never ships
   * in one response.
   */
  findAllForUser(userId: string, opts: { from?: Date; limit?: number } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 1000);
    return this.prisma.transaction.findMany({
      where: { userId, ...(opts.from ? { date: { gte: opts.from } } : {}) },
      orderBy: { date: 'desc' },
      take,
    });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException(`Transaction ${id} not found`);
    return transaction;
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const transaction = await this.findOne(id);
    const oldSection = await this.prisma.section.findUnique({ where: { id: transaction.sectionId }, include: { goal: true } });

    const oldAccount = await this.prisma.account.findUniqueOrThrow({ where: { id: transaction.accountId } });
    const newAccount =
      dto.accountId !== undefined && dto.accountId !== transaction.accountId
        ? await this.assertAccountOwnedByUser(dto.accountId, transaction.userId)
        : oldAccount;
    const targetSectionId = dto.sectionId ?? transaction.sectionId;
    let newSection = oldSection;
    if (dto.sectionId !== undefined || dto.confirmed !== undefined) {
      newSection = await this.loadSectionAndCheckProtection(targetSectionId, dto.confirmed);
    }

    const definedUpdates = Object.fromEntries(
      Object.entries(dto).filter(([key, v]) => v !== undefined && key !== 'confirmed'),
    );
    if ('date' in definedUpdates) {
      definedUpdates.date = new Date(definedUpdates.date as string);
    }
    // Moving an expense to another section ends its link to the old section's bill.
    if (dto.sectionId !== undefined && dto.sectionId !== transaction.sectionId) {
      definedUpdates.listingId = null;
    }

    // Reverse the old amount off the old account (and old Goal, if any), then
    // apply the new amount to the (possibly different) new account/Goal —
    // simpler and just as correct as netting a delta, even when nothing changed.
    const newAmount = dto.amount ?? transaction.amount.toString();
    const newDate = 'date' in definedUpdates ? (definedUpdates.date as Date) : transaction.date;

    const ops = [
      ...this.balanceOp(oldAccount, transaction.date, transaction.amount, -1),
      ...this.balanceOp(newAccount, newDate, newAmount, 1),
      ...this.goalDeltaOp(oldSection?.goal, transaction.amount.negated()),
      ...this.goalDeltaOp(newSection?.goal, newAmount),
      this.prisma.transaction.update({ where: { id }, data: definedUpdates }),
    ];
    const results = await this.prisma.$transaction(ops);
    return results[results.length - 1];
  }

  async remove(id: string) {
    const transaction = await this.findOne(id);
    const section = await this.prisma.section.findUnique({ where: { id: transaction.sectionId }, include: { goal: true } });
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: transaction.accountId } });
    await this.prisma.$transaction([
      ...this.balanceOp(account, transaction.date, transaction.amount, -1),
      ...this.goalDeltaOp(section?.goal, transaction.amount.negated()),
      this.prisma.transaction.delete({ where: { id } }),
    ]);
  }
}
