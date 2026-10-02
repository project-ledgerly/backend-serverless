import { Injectable } from '@nestjs/common';
import type { IncomeFrequency } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CatchUpResult {
  incomeId: string;
  accountId: string;
  cyclesApplied: number;
  totalCredited: string;
  nextRunDate: string;
}

/**
 * No 24/7 process runs this. A request (see IncomeController#catchUp) calls
 * it — typically on app open — and it walks every recurring Income's
 * nextRunDate forward one month at a time for each cycle already due,
 * crediting the linked Account each time, until nextRunDate is in the
 * future. Covers the app being closed for any length of time, not just one
 * missed cycle.
 */
@Injectable()
export class IncomeSchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  async catchUp(userId: string): Promise<CatchUpResult[]> {
    const due = await this.prisma.income.findMany({
      where: { userId, recurring: true, nextRunDate: { lte: new Date() } },
    });

    const results: CatchUpResult[] = [];
    for (const income of due) {
      if (!income.nextRunDate) continue;

      const dueDates: Date[] = [];
      let cursor = income.nextRunDate;
      const now = new Date();
      while (cursor <= now) {
        dueDates.push(cursor);
        cursor = advance(cursor, income.frequency);
      }
      if (dueDates.length === 0) continue;

      const totalCredited = income.amount.times(dueDates.length);
      await this.prisma.$transaction([
        this.prisma.account.update({
          where: { id: income.accountId },
          data: { balance: { increment: totalCredited } },
        }),
        this.prisma.income.update({
          where: { id: income.id },
          data: { nextRunDate: cursor },
        }),
        // One receipt per cycle, dated to when it was actually due — not
        // collapsed into one lump sum — so the history stays accurate even
        // after a long catch-up.
        this.prisma.incomeReceipt.createMany({
          data: dueDates.map((date) => ({ incomeId: income.id, accountId: income.accountId, amount: income.amount, date })),
        }),
      ]);

      results.push({
        incomeId: income.id,
        accountId: income.accountId,
        cyclesApplied: dueDates.length,
        totalCredited: totalCredited.toString(),
        nextRunDate: cursor.toISOString(),
      });
    }
    return results;
  }
}

// Null frequency (an old row predating this field, or a bug elsewhere) falls
// back to monthly — the previous hardcoded behavior — rather than looping
// forever on an un-advancing cursor.
function advance(date: Date, frequency: IncomeFrequency | null): Date {
  const next = new Date(date);
  switch (frequency) {
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      return next;
    case 'BIWEEKLY':
      next.setDate(next.getDate() + 14);
      return next;
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + 1);
      return next;
    case 'MONTHLY':
    default:
      next.setMonth(next.getMonth() + 1);
      return next;
  }
}
