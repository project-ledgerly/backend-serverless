import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { describeErrors, fromCents, planBatch, toCents } from './batch.planner.js';
import { RecordsService } from './records.service.js';
import type { LogBatchDto } from './dto/log-batch.dto.js';

/** Most rows one token may log in 24 hours, so a looping AI can't flood the data. */
export const DAILY_ROW_CAP = 1000;
const DAY_MS = 86_400_000;

const num = (d: { toString(): string }) => Number(d.toString());

@Injectable()
export class BatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
  ) {}

  async log(auth: AuthContext, dto: LogBatchDto) {
    const userId = auth.userId;

    if (auth.tokenId && !dto.dryRun) {
      const since = new Date(Date.now() - DAY_MS);
      const recent = await this.prisma.batch.aggregate({
        where: { userId, tokenId: auth.tokenId, createdAt: { gte: since } },
        _sum: { transactionCount: true, transferCount: true },
      });
      const used = (recent._sum.transactionCount ?? 0) + (recent._sum.transferCount ?? 0);
      if (used + dto.rows.length > DAILY_ROW_CAP) {
        throw new HttpException(
          `This token has logged ${used} rows in the last 24 hours and the limit is ${DAILY_ROW_CAP}. Try again later.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const times = dto.rows.map((r) => new Date(r.date).getTime()).filter((t) => !Number.isNaN(t));
    const from = new Date(Math.min(...times) - 2 * DAY_MS);
    const to = new Date(Math.max(...times) + 2 * DAY_MS);

    const [accounts, sections, listings, existingTx, existingTr] = await Promise.all([
      this.prisma.account.findMany({ where: { userId }, select: { id: true, name: true } }),
      this.prisma.section.findMany({
        where: { plan: { userId } },
        select: { id: true, name: true, goal: { select: { id: true, mode: true } } },
      }),
      this.prisma.listing.findMany({ where: { userId }, select: { id: true, name: true, sectionId: true } }),
      times.length
        ? this.prisma.transaction.findMany({
            where: { userId, date: { gte: from, lte: to } },
            select: { id: true, accountId: true, date: true, amount: true, description: true, source: true },
          })
        : [],
      times.length
        ? this.prisma.transfer.findMany({
            where: { userId, date: { gte: from, lte: to } },
            select: { fromAccountId: true, toAccountId: true, date: true, amount: true },
          })
        : [],
    ]);

    const plan = planBatch(dto.rows, {
      now: new Date(),
      accounts,
      allowedAccountIds: auth.accountIds,
      sections,
      listings,
      existingTransactions: existingTx.map((t) => ({
        id: t.id,
        source: t.source,
        accountId: t.accountId,
        date: t.date,
        cents: toCents(num(t.amount)),
        description: t.description,
      })),
      existingTransfers: existingTr.map((t) => ({
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        date: t.date,
        cents: toCents(num(t.amount)),
      })),
    });

    if (plan.errors.length > 0) throw new BadRequestException(describeErrors(plan.errors));

    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const balanceChanges = [...plan.accountDeltas.entries()].map(([id, cents]) => ({
      account: accountName.get(id) ?? id,
      change: Number(fromCents(cents)),
    }));
    const result = {
      dryRun: Boolean(dto.dryRun),
      batchId: null as string | null,
      created: { transactions: plan.transactions.length, transfers: plan.transfers.length },
      skipped: plan.skipped,
      // Likely the user's own entries of the same purchases: see the instructions on what to do.
      possibleDuplicates: plan.possibleDuplicates,
      warnings: plan.warnings,
      balanceChanges,
    };

    if (dto.dryRun || (plan.transactions.length === 0 && plan.transfers.length === 0)) return result;

    // Totals per account and goal, so a 200-row import is a handful of
    // statements inside one transaction instead of hundreds.
    const batchId = randomUUID();
    const batch = this.prisma.batch.create({
      data: {
        id: batchId,
        userId,
        tokenId: auth.tokenId,
        summary: dto.summary,
        transactionCount: plan.transactions.length,
        transferCount: plan.transfers.length,
      },
    });
    await this.prisma.$transaction([
      batch,
      ...(plan.transactions.length
        ? [
            this.prisma.transaction.createMany({
              data: plan.transactions.map((t) => ({
                id: t.id,
                batchId,
                userId,
                accountId: t.accountId,
                sectionId: t.sectionId,
                listingId: t.listingId,
                amount: fromCents(t.cents),
                description: t.description,
                merchant: t.merchant,
                raw: t.raw,
                date: t.date,
                source: 'ai',
              })),
            }),
          ]
        : []),
      ...(plan.transfers.length
        ? [
            this.prisma.transfer.createMany({
              data: plan.transfers.map((t) => ({
                id: t.id,
                batchId,
                userId,
                fromAccountId: t.fromAccountId,
                toAccountId: t.toAccountId,
                amount: fromCents(t.cents),
                note: t.note,
                goalSectionId: t.goalSectionId,
                date: t.date,
              })),
            }),
          ]
        : []),
      ...[...plan.accountDeltas.entries()].map(([id, cents]) =>
        this.prisma.account.update({ where: { id }, data: { balance: { increment: fromCents(cents) } } }),
      ),
      ...[...plan.goalDeltas.entries()].map(([id, cents]) =>
        this.prisma.goal.update({ where: { id }, data: { currentAmount: { increment: fromCents(cents) } } }),
      ),
    ]);

    return { ...result, batchId };
  }

  /** Newest first. Gives the AI (and the app) the ids to undo. */
  async list(userId: string) {
    const batches = await this.prisma.batch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return batches.map((b) => ({
      id: b.id,
      kind: b.kind,
      summary: b.summary,
      createdAt: b.createdAt,
      transactions: b.transactionCount,
      transfers: b.transferCount,
      undone: b.undoneAt !== null,
    }));
  }

  /**
   * Puts everything an import did back: balances, goal totals and all, using
   * the rows as they are now. A row the user already deleted is simply gone
   * (deleting it already reversed its effect), and one they edited is
   * reversed at its edited value, so balances always end up right.
   */
  async undo(userId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.undoneAt) return { batchId, alreadyUndone: true, removed: { transactions: 0, transfers: 0 } };
    if (batch.kind !== 'import') return this.records.undo(batch);

    const [transactions, transfers] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { batchId },
        select: { accountId: true, amount: true, section: { select: { goal: { select: { id: true, mode: true } } } } },
      }),
      this.prisma.transfer.findMany({ where: { batchId } }),
    ]);

    const accountDeltas = new Map<string, number>();
    const goalDeltas = new Map<string, number>();
    const add = (map: Map<string, number>, id: string, cents: number) => map.set(id, (map.get(id) ?? 0) + cents);

    for (const t of transactions) {
      const cents = toCents(num(t.amount));
      add(accountDeltas, t.accountId, -cents);
      const goal = t.section.goal;
      if (goal && goal.mode !== 'RESERVE') add(goalDeltas, goal.id, -cents);
    }
    const goalBySection = new Map(
      (
        await this.prisma.goal.findMany({
          where: { sectionId: { in: transfers.map((t) => t.goalSectionId).filter((x): x is string => !!x) } },
          select: { id: true, sectionId: true },
        })
      ).map((g) => [g.sectionId, g.id]),
    );
    for (const t of transfers) {
      const cents = toCents(num(t.amount));
      add(accountDeltas, t.fromAccountId, cents);
      add(accountDeltas, t.toAccountId, -cents);
      const goalId = t.goalSectionId ? goalBySection.get(t.goalSectionId) : undefined;
      if (goalId) add(goalDeltas, goalId, -cents);
    }

    await this.prisma.$transaction([
      ...[...accountDeltas.entries()].map(([id, cents]) =>
        this.prisma.account.update({ where: { id }, data: { balance: { increment: fromCents(cents) } } }),
      ),
      ...[...goalDeltas.entries()].map(([id, cents]) =>
        this.prisma.goal.update({ where: { id }, data: { currentAmount: { increment: fromCents(cents) } } }),
      ),
      this.prisma.transaction.deleteMany({ where: { batchId } }),
      this.prisma.transfer.deleteMany({ where: { batchId } }),
      this.prisma.batch.update({ where: { id: batchId }, data: { undoneAt: new Date() } }),
    ]);

    return { batchId, alreadyUndone: false, removed: { transactions: transactions.length, transfers: transfers.length } };
  }
}
