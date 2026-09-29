import { Injectable } from '@nestjs/common';
import { GoalMode } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GoalRolloverResult {
  goalId: string;
  periodStart: string;
  periodEnd: string;
  targetAmount: string;
  actualAmount: string;
  // Positive = surplus, negative = shortfall. Purely informational — nothing
  // here carries it into next month's target automatically; that's the
  // user's own call.
  difference: string;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Lazy catch-up, same shape as IncomeSchedulerService — no background
 * process. A request (call this on app open) walks each MONTHLY_RECURRING
 * goal's currentPeriodStart forward one calendar month at a time for every
 * month already elapsed, archiving each one into a GoalMonthSnapshot before
 * resetting currentAmount to 0 for the new month.
 */
@Injectable()
export class GoalSchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  async catchUp(userId: string): Promise<GoalRolloverResult[]> {
    const goals = await this.prisma.goal.findMany({
      where: { mode: GoalMode.MONTHLY_RECURRING, section: { plan: { userId } } },
    });

    const currentMonth = startOfMonth(new Date());
    const results: GoalRolloverResult[] = [];

    for (const goal of goals) {
      if (!goal.currentPeriodStart) continue;
      let periodStart = goal.currentPeriodStart;
      if (periodStart >= currentMonth) continue;

      // Only the elapsed period we're rolling out of actually has real
      // accumulated data (currentAmount); every later skipped month, if
      // the app wasn't opened for a while, had no transactions logged
      // against it at all, so it archives as a flat 0.
      let actualAmount: Decimal = goal.currentAmount;
      const snapshots: { periodStart: Date; periodEnd: Date; actualAmount: Decimal }[] = [];
      while (periodStart < currentMonth) {
        const periodEnd = addOneMonth(periodStart);
        snapshots.push({ periodStart, periodEnd, actualAmount });
        results.push({
          goalId: goal.id,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          targetAmount: goal.targetAmount.toString(),
          actualAmount: actualAmount.toString(),
          difference: actualAmount.minus(goal.targetAmount).toString(),
        });
        actualAmount = new Decimal(0);
        periodStart = periodEnd;
      }

      await this.prisma.$transaction([
        this.prisma.goalMonthSnapshot.createMany({
          data: snapshots.map((s) => ({
            goalId: goal.id,
            periodStart: s.periodStart,
            periodEnd: s.periodEnd,
            targetAmount: goal.targetAmount,
            actualAmount: s.actualAmount,
          })),
        }),
        this.prisma.goal.update({
          where: { id: goal.id },
          data: { currentAmount: '0', currentPeriodStart: periodStart },
        }),
      ]);
    }

    return results;
  }
}
