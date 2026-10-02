import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateIncomeDto } from './dto/create-income.dto.js';
import type { UpdateIncomeDto } from './dto/update-income.dto.js';

@Injectable()
export class IncomeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateIncomeDto) {
    const recurring = dto.recurring ?? false;

    const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
    if (!account || account.userId !== dto.userId) {
      throw new BadRequestException(`accountId ${dto.accountId} is not an account of user ${dto.userId}`);
    }

    const date = new Date(dto.date);

    // One-off income is money already received — credit it and log the
    // receipt now. Recurring income is a template; the first (and every
    // later) cycle is applied by IncomeSchedulerService.catchUp instead, so
    // it isn't double-credited here.
    if (!recurring) {
      return this.prisma.$transaction(async (tx) => {
        const income = await tx.income.create({
          data: { userId: dto.userId, amount: dto.amount, source: dto.source, date, recurring, accountId: dto.accountId },
        });
        await tx.account.update({ where: { id: dto.accountId }, data: { balance: { increment: dto.amount } } });
        await tx.incomeReceipt.create({
          data: { incomeId: income.id, accountId: dto.accountId, amount: dto.amount, date },
        });
        return income;
      });
    }

    return this.prisma.income.create({
      data: {
        userId: dto.userId,
        amount: dto.amount,
        source: dto.source,
        date,
        recurring,
        frequency: dto.frequency,
        accountId: dto.accountId,
        // First due cycle is the income's own date — if it's already in the
        // past, catch-up picks it up on the next request instead of losing it.
        nextRunDate: date,
      },
    });
  }

  findAllForUser(userId: string) {
    return this.prisma.income.findMany({ where: { userId }, orderBy: { date: 'desc' } });
  }

  async findOne(id: string) {
    const income = await this.prisma.income.findUnique({ where: { id } });
    if (!income) throw new NotFoundException(`Income ${id} not found`);
    return income;
  }

  /**
   * Edits an income.
   *
   * A recurring income is a template for future paydays, so its amount,
   * source, frequency, next payday and account can all change; past
   * receipts keep what was actually credited. A one-off income is money
   * that already landed in an account (with a receipt), so changing its
   * amount or account would silently rewrite history: only its `source`
   * label can be edited.
   */
  async update(id: string, dto: UpdateIncomeDto) {
    const income = await this.findOne(id);

    if (!income.recurring) {
      const touchesMoney =
        dto.amount !== undefined || dto.frequency !== undefined || dto.nextRunDate !== undefined || dto.accountId !== undefined;
      if (touchesMoney) {
        throw new BadRequestException(
          'This income was a one-off that has already been received, so only its source can be renamed',
        );
      }
    }

    if (dto.amount !== undefined && !(Number(dto.amount) > 0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    if (dto.accountId !== undefined) {
      const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
      if (!account || account.userId !== income.userId) {
        throw new BadRequestException(`accountId ${dto.accountId} is not an account of user ${income.userId}`);
      }
    }

    return this.prisma.income.update({
      where: { id },
      data: {
        ...(dto.source !== undefined ? { source: dto.source.trim() } : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.nextRunDate !== undefined ? { nextRunDate: new Date(dto.nextRunDate) } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
      },
    });
  }

  /**
   * Removes a recurring income. With no history it is deleted outright; once
   * it has credited money (receipts) or fed an allocation it is stopped
   * instead (no longer recurring, nothing scheduled) so that history keeps
   * its source. A one-off income cannot be removed: the money is already in
   * the account.
   */
  async remove(id: string) {
    const income = await this.findOne(id);
    if (!income.recurring) {
      throw new ConflictException('A one-off income has already been received and cannot be removed');
    }
    const [receipts, allocations] = await Promise.all([
      this.prisma.incomeReceipt.count({ where: { incomeId: id } }),
      this.prisma.sectionAllocation.count({ where: { incomeId: id } }),
    ]);
    if (receipts === 0 && allocations === 0) {
      await this.prisma.income.delete({ where: { id } });
      return;
    }
    await this.prisma.income.update({
      where: { id },
      data: { recurring: false, nextRunDate: null, frequency: null },
    });
  }

  /** The actual money-received history — what answers "how much are we getting". */
  findReceiptsForUser(userId: string) {
    return this.prisma.incomeReceipt.findMany({
      where: { income: { userId } },
      orderBy: { date: 'desc' },
    });
  }
}
