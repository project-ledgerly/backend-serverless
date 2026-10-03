/**
 * The budget period follows the salary, not the calendar: a salary paid on the
 * 28th starts a period on the 28th that runs to the 27th. Everything that used to
 * mean "this month" (what is left to spend, the monthly chart, bills paid) uses
 * this instead. Dates are UTC days, the same as the stored paydays.
 *
 * The app has the same rules in lib/core/utils/pay_cycle.dart; keep them in step.
 */

export interface CycleIncome {
  amount: number;
  recurring: boolean;
  frequency: string | null;
  /** The next payday. Its day of the month (or weekday spacing) sets the cycle. */
  nextRunDate: Date | null;
}

export interface PayCycle {
  /** First day of the period (a payday), inclusive. */
  start: Date;
  /** First day of the next period, exclusive. */
  end: Date;
  basis: 'payday' | 'calendar';
  /** The income the period follows, when there is one. */
  frequency: string | null;
}

const DAY_MS = 86_400_000;

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The payday of month (year, month) for a payday on day [day], clamped for short months. */
function occurrence(year: number, month: number, day: number): Date {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
}

/**
 * The income that sets the rhythm: the largest recurring monthly one, else the
 * largest recurring weekly or fortnightly one. Yearly and one-off income do not
 * make a period. Returns null when nothing qualifies.
 */
export function primaryIncome(incomes: readonly CycleIncome[]): CycleIncome | null {
  const usable = incomes.filter((i) => i.recurring && i.nextRunDate && ['MONTHLY', 'WEEKLY', 'BIWEEKLY'].includes(i.frequency ?? ''));
  const biggest = (list: CycleIncome[]) => list.reduce<CycleIncome | null>((best, i) => (!best || i.amount > best.amount ? i : best), null);
  return biggest(usable.filter((i) => i.frequency === 'MONTHLY')) ?? biggest(usable);
}

export function calendarCycle(date: Date): PayCycle {
  return {
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
    basis: 'calendar',
    frequency: null,
  };
}

/** The pay period that contains [date]. */
export function payCycleContaining(date: Date, incomes: readonly CycleIncome[]): PayCycle {
  const income = primaryIncome(incomes);
  if (!income?.nextRunDate) return calendarCycle(date);

  const day = dayOf(date);
  const anchor = dayOf(income.nextRunDate);

  if (income.frequency === 'MONTHLY') {
    const payday = anchor.getUTCDate();
    const thisMonth = occurrence(day.getUTCFullYear(), day.getUTCMonth(), payday);
    const started = thisMonth.getTime() <= day.getTime();
    const start = started ? thisMonth : occurrence(day.getUTCFullYear(), day.getUTCMonth() - 1, payday);
    const end = started ? occurrence(day.getUTCFullYear(), day.getUTCMonth() + 1, payday) : thisMonth;
    return { start, end, basis: 'payday', frequency: 'MONTHLY' };
  }

  const step = (income.frequency === 'WEEKLY' ? 7 : 14) * DAY_MS;
  const k = Math.floor((day.getTime() - anchor.getTime()) / step);
  const start = new Date(anchor.getTime() + k * step);
  return { start, end: new Date(start.getTime() + step), basis: 'payday', frequency: income.frequency };
}

/** The [count] periods ending with the one that contains [now], oldest first. */
export function recentPayCycles(now: Date, incomes: readonly CycleIncome[], count: number): PayCycle[] {
  const cycles: PayCycle[] = [];
  let cursor = payCycleContaining(now, incomes);
  for (let i = 0; i < count; i++) {
    cycles.unshift(cursor);
    cursor = payCycleContaining(new Date(cursor.start.getTime() - DAY_MS), incomes);
  }
  return cycles;
}
