import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GoalMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthlyContribution } from '../engine/sinkingFundCalculator.js';
import { recentPayCycles } from '../pay-cycle/pay-cycle.js';
import type { CreateGoalDto } from './dto/create-goal.dto.js';
import type { UpdateGoalDto } from './dto/update-goal.dto.js';

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Where each point of a goal's trend ends: the last 6 pay periods (payday to the day
 * before the next), oldest first, so "added this month" means this pay period like the
 * rest of the app. With no recurring salary these are calendar months.
 */
export function goalHistoryEnds(
  now: Date,
  incomes: { amount: unknown; recurring: boolean; frequency: string | null; nextRunDate: Date | null }[],
): Date[] {
  return recentPayCycles(
    now,
    incomes.map((i) => ({ amount: Number(i.amount), recurring: i.recurring, frequency: i.frequency, nextRunDate: i.nextRunDate })),
    6,
  ).map((c) => c.end);
}

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(sectionId: string, dto: CreateGoalDto) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
    if (section.type !== 'SAVINGS' && section.type !== 'GOAL') {
      throw new BadRequestException('A Goal can only attach to a SAVINGS or GOAL section');
    }

    const mode = dto.mode ?? GoalMode.TARGET;
    if (!new Prisma.Decimal(dto.targetAmount).gt(0)) {
      throw new BadRequestException('targetAmount must be greater than 0');
    }
    if (mode === GoalMode.TARGET && !dto.targetDate) {
      throw new BadRequestException('targetDate is required for a TARGET-mode goal');
    }
    if (mode === GoalMode.RESERVE) {
      // Keep at least targetAmount in the section's account: there has to be
      // an account, and it has to hold that much today, or the goal would be
      // broken from the moment it is set.
      if (!section.accountId) {
        throw new BadRequestException('A reserve goal needs a section linked to an account');
      }
      const account = await this.prisma.account.findUnique({ where: { id: section.accountId } });
      if (account && account.balance.lt(dto.targetAmount)) {
        throw new BadRequestException(
          `"${account.name}" holds ${account.balance.toFixed(2)}, which is less than the ${new Prisma.Decimal(dto.targetAmount).toFixed(2)} you want to keep in it`,
        );
      }
    }

    const starting = mode === GoalMode.RESERVE ? new Prisma.Decimal(0) : new Prisma.Decimal(dto.startingAmount ?? 0);
    if (starting.lt(0)) throw new BadRequestException('startingAmount cannot be negative');

    const now = new Date();
    const autoCalculated = dto.autoCalculated ?? true;
    const targetDate = mode === GoalMode.TARGET ? new Date(dto.targetDate!) : null;
    const monthly =
      mode === GoalMode.TARGET && autoCalculated
        ? monthlyContribution({ id: 'pending', sectionId, targetAmount: dto.targetAmount, currentAmount: starting.toString(), targetDate: targetDate!, autoCalculated }, now)
        : null;

    try {
      return await this.prisma.goal.create({
        data: {
          sectionId,
          mode,
          targetAmount: dto.targetAmount,
          currentAmount: starting.toString(),
          startingAmount: starting.toString(),
          targetDate,
          monthlyContribution: monthly?.toString() ?? null,
          autoCalculated,
          currentPeriodStart: mode === GoalMode.MONTHLY_RECURRING ? startOfMonth(now) : null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Section ${sectionId} already has a Goal`);
      }
      throw error;
    }
  }

  /**
   * Every Goal across the user's plans, each with its Section's name (a Goal
   * has no name of its own) and `history`: the goal's running total at the
   * end of each of the last 6 pay periods (the current period's point is
   * the live currentAmount), derived from the Transactions on its Section —
   * the same ledger currentAmount itself is derived from. Feeds the
   * Dashboard's goal trend lines.
   */
  async findAllForUser(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { section: { plan: { userId } } },
      include: { section: { select: { name: true, accountId: true } } },
      orderBy: { id: 'asc' },
    });
    if (goals.length === 0) return [];

    const incomes = await this.prisma.income.findMany({ where: { userId } });
    const monthEnds = goalHistoryEnds(new Date(), incomes);

    const sectionIds = goals.map((g) => g.sectionId);
    const [spent, paidIn] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { sectionId: { in: sectionIds } },
        select: { sectionId: true, amount: true, date: true },
      }),
      // Transfers tagged to a goal add to it the same way.
      this.prisma.transfer.findMany({
        where: { goalSectionId: { in: sectionIds } },
        select: { goalSectionId: true, amount: true, date: true },
      }),
    ]);
    const transactions = [
      ...spent,
      ...paidIn.map((t) => ({ sectionId: t.goalSectionId!, amount: t.amount, date: t.date })),
    ];

    return goals.map(({ section, ...goal }) => {
      const mine = transactions.filter((t) => t.sectionId === goal.sectionId);
      const history = monthEnds.map((end, i) => {
        if (i === monthEnds.length - 1) return goal.currentAmount.toFixed(2);
        const total = mine
          .filter((t) => t.date < end)
          .reduce((sum, t) => sum.plus(t.amount), goal.startingAmount);
        return total.toFixed(2);
      });
      return { ...goal, name: section.name, accountId: section.accountId, history };
    });
  }

  async findForSection(sectionId: string) {
    const goal = await this.prisma.goal.findUnique({ where: { sectionId } });
    if (!goal) throw new NotFoundException(`Section ${sectionId} has no Goal`);
    return goal;
  }

  async findOne(id: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal) throw new NotFoundException(`Goal ${id} not found`);
    return goal;
  }

  async update(id: string, dto: UpdateGoalDto) {
    const goal = await this.findOne(id);
    if (goal.mode !== GoalMode.TARGET && (dto.targetDate !== undefined)) {
      throw new BadRequestException('targetDate only applies to TARGET-mode goals');
    }

    const targetAmount = dto.targetAmount ?? goal.targetAmount.toString();
    if (!new Prisma.Decimal(targetAmount).gt(0)) {
      throw new BadRequestException('targetAmount must be greater than 0');
    }
    if (goal.mode === GoalMode.RESERVE && dto.targetAmount !== undefined) {
      // Same rule as creating one: the account has to hold the line today.
      const section = await this.prisma.section.findUnique({ where: { id: goal.sectionId } });
      const account = section?.accountId ? await this.prisma.account.findUnique({ where: { id: section.accountId } }) : null;
      if (account && account.balance.lt(targetAmount)) {
        throw new BadRequestException(
          `"${account.name}" holds ${account.balance.toFixed(2)}, which is less than the ${new Prisma.Decimal(targetAmount).toFixed(2)} you want to keep in it`,
        );
      }
    }
    // Moving the starting amount moves the running total with it.
    let startingAmount = goal.startingAmount;
    let currentAmount = goal.currentAmount;
    if (dto.startingAmount !== undefined && goal.mode !== GoalMode.RESERVE) {
      const next = new Prisma.Decimal(dto.startingAmount);
      if (next.lt(0)) throw new BadRequestException('startingAmount cannot be negative');
      currentAmount = currentAmount.plus(next.minus(startingAmount));
      startingAmount = next;
    }
    const targetDate = dto.targetDate !== undefined ? new Date(dto.targetDate) : goal.targetDate;
    const autoCalculated = dto.autoCalculated ?? goal.autoCalculated;

    const monthly =
      goal.mode === GoalMode.TARGET && autoCalculated && targetDate
        ? monthlyContribution(
            { id: goal.id, sectionId: goal.sectionId, targetAmount, currentAmount: currentAmount.toString(), targetDate, autoCalculated },
            new Date(),
          )
        : goal.monthlyContribution;

    return this.prisma.goal.update({
      where: { id },
      data: {
        targetAmount,
        targetDate,
        startingAmount,
        currentAmount,
        autoCalculated,
        monthlyContribution: monthly?.toString() ?? null,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Its month snapshots go with it; transfers that were tagged to it just
    // lose the tag (the money they moved stays where it went).
    await this.prisma.$transaction([
      this.prisma.goalMonthSnapshot.deleteMany({ where: { goalId: id } }),
      this.prisma.goal.delete({ where: { id } }),
    ]);
  }
}
