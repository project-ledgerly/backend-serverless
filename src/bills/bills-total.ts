import { Decimal } from 'decimal.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { payCycleContaining } from '../pay-cycle/pay-cycle.js';
import { amountDueInPeriod } from './bill-schedule.js';

/**
 * What each BILLS section of a plan holds: the total of its bills that fall due in the pay
 * period containing [now]. A section's amount is this, not a percentage of income.
 */
export async function billsTotalsForPlan(prisma: PrismaService, planId: string, userId: string, now = new Date()): Promise<Map<string, Decimal>> {
  const totals = new Map<string, Decimal>();
  const sections = await prisma.section.findMany({ where: { planId, type: 'BILLS' }, select: { id: true } });
  if (sections.length === 0) return totals;

  const [incomes, bills] = await Promise.all([
    prisma.income.findMany({ where: { userId } }),
    prisma.listing.findMany({ where: { sectionId: { in: sections.map((s) => s.id) } } }),
  ]);
  const cycle = payCycleContaining(
    now,
    incomes.map((i) => ({ amount: Number(i.amount), recurring: i.recurring, frequency: i.frequency, nextRunDate: i.nextRunDate })),
  );
  for (const s of sections) totals.set(s.id, new Decimal(0));
  for (const b of bills) {
    const due = amountDueInPeriod(
      { recurrence: b.recurrence, dueDay: b.dueDay, dueDate: b.dueDate, amount: Number(b.amount) },
      { start: cycle.start, end: cycle.end },
    );
    totals.set(b.sectionId, (totals.get(b.sectionId) ?? new Decimal(0)).plus(due));
  }
  return totals;
}
