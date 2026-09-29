import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateIncomeDto } from './dto/create-income.dto.js';

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

  /** The actual money-received history — what answers "how much are we getting". */
  findReceiptsForUser(userId: string) {
    return this.prisma.incomeReceipt.findMany({
      where: { income: { userId } },
      orderBy: { date: 'desc' },
    });
  }
}
