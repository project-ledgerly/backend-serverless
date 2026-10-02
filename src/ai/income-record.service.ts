import { BadRequestException, Injectable } from '@nestjs/common';
import type { Batch } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { IncomeService } from '../income/income.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import type { RecordIncomeDto } from './dto/edit-plan.dto.js';
import { fromCents, toCents } from './effects.js';

const MIN_YEAR = 2000;
const MAX_FUTURE_DAYS = 31;

@Injectable()
export class IncomeRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly incomes: IncomeService,
  ) {}

  /**
   * Records money that has already arrived (a fee, a gift, a one-off payment):
   * credits the account and keeps a receipt, exactly like adding it in the app.
   * The same payment recorded twice is spotted and left alone.
   */
  async record(auth: AuthContext, dto: RecordIncomeDto) {
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < MIN_YEAR || date.getTime() > Date.now() + MAX_FUTURE_DAYS * 86_400_000) {
      throw new BadRequestException(`date ${dto.date} is not a sensible date`);
    }
    const cents = toCents(dto.amount);
    if (cents <= 0) throw new BadRequestException('amount must be greater than 0');
    if (auth.accountIds.length > 0 && !auth.accountIds.includes(dto.accountId)) {
      throw new BadRequestException('This token is not allowed to use that account');
    }

    // Already there? Same account, amount and day, from a payer with the same name.
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const existing = await this.prisma.incomeReceipt.findMany({
      where: { accountId: dto.accountId, income: { userId: auth.userId }, date: { gte: dayStart, lt: dayEnd } },
      include: { income: { select: { source: true } } },
    });
    const dup = existing.find((r) => toCents(Number(r.amount)) === cents && r.income.source.trim().toLowerCase() === dto.source.trim().toLowerCase());
    if (dup) return { duplicate: true, batchId: null as string | null, message: 'This income is already recorded; nothing was added.' };

    const income = await this.incomes.create({
      userId: auth.userId,
      amount: fromCents(cents),
      source: dto.source.trim(),
      date: dto.date,
      recurring: false,
      accountId: dto.accountId,
    } as never);

    const batchId = randomUUID();
    await this.prisma.batch.create({
      data: {
        id: batchId,
        userId: auth.userId,
        tokenId: auth.tokenId,
        kind: 'income',
        summary: dto.summary ?? `Recorded income: ${dto.source.trim()} ${fromCents(cents)}`,
        undoData: { incomeId: income.id, accountId: dto.accountId, cents },
      },
    });
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: dto.accountId } });
    return {
      duplicate: false,
      batchId,
      incomeId: income.id,
      account: account.name,
      added: cents / 100,
      balanceNow: Number(account.balance),
    };
  }

  async undo(batch: Batch) {
    const data = batch.undoData as { incomeId: string; accountId: string; cents: number };
    await this.prisma.$transaction([
      this.prisma.incomeReceipt.deleteMany({ where: { incomeId: data.incomeId } }),
      this.prisma.income.deleteMany({ where: { id: data.incomeId } }),
      this.prisma.account.update({ where: { id: data.accountId }, data: { balance: { decrement: fromCents(data.cents) } } }),
      this.prisma.batch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } }),
    ]);
    return { batchId: batch.id, alreadyUndone: false, kind: batch.kind, restored: { accountBalanceChange: -data.cents / 100 } };
  }
}
