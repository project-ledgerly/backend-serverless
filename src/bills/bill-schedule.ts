// When a bill falls due. A bill is defined once (a Listing) and the dates it falls on in a pay
// period are worked out from that, not stored per period. Plain code, no Nest or Prisma.

export type BillRecurrence = 'MONTHLY' | 'WEEKLY' | 'YEARLY' | 'ONCE';

export interface ScheduledBill {
  recurrence: BillRecurrence;
  /** Day of the month (MONTHLY). Null = no fixed day. */
  dueDay: number | null;
  /** ONCE: the due date. YEARLY: its month and day. WEEKLY: its weekday. */
  dueDate: Date | null;
}

/** A pay period: [start, end), both UTC midnights. */
export interface Period {
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The date of day-of-month [day] in (year, month), clamped for short months. Month may overflow. */
function inMonth(year: number, month: number, day: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, daysInMonth(first.getUTCFullYear(), first.getUTCMonth()))));
}

const inPeriod = (d: Date, p: Period) => d.getTime() >= p.start.getTime() && d.getTime() < p.end.getTime();

/**
 * The dates the bill falls due on inside [period], in order. A MONTHLY bill with no due day has
 * no date but still falls due once per period, so it comes back as one null.
 */
export function dueDatesInPeriod(bill: ScheduledBill, period: Period): (Date | null)[] {
  switch (bill.recurrence) {
    case 'ONCE': {
      if (!bill.dueDate) return [];
      const d = dayOf(bill.dueDate);
      return inPeriod(d, period) ? [d] : [];
    }
    case 'YEARLY': {
      if (!bill.dueDate) return [];
      const anchor = dayOf(bill.dueDate);
      const found: Date[] = [];
      for (const year of [period.start.getUTCFullYear(), period.end.getUTCFullYear()]) {
        const d = inMonth(year, anchor.getUTCMonth(), anchor.getUTCDate());
        if (inPeriod(d, period) && !found.some((f) => f.getTime() === d.getTime())) found.push(d);
      }
      return found;
    }
    case 'WEEKLY': {
      if (!bill.dueDate) return [];
      const anchor = dayOf(bill.dueDate);
      const weekday = anchor.getUTCDay();
      const firstOffset = (weekday - period.start.getUTCDay() + 7) % 7;
      const found: Date[] = [];
      for (let t = period.start.getTime() + firstOffset * DAY_MS; t < period.end.getTime(); t += 7 * DAY_MS) {
        if (t >= anchor.getTime()) found.push(new Date(t));
      }
      return found;
    }
    case 'MONTHLY':
    default: {
      if (bill.dueDay == null) return [null];
      const found: Date[] = [];
      let cursor = new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), 1));
      while (cursor.getTime() < period.end.getTime()) {
        const d = inMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), bill.dueDay);
        if (inPeriod(d, period)) found.push(d);
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      }
      // A due day that lands outside the period in a short month still falls due once.
      return found.length > 0 ? found : [null];
    }
  }
}

/** How many times the bill falls due in the period. */
export function occurrencesInPeriod(bill: ScheduledBill, period: Period): number {
  return dueDatesInPeriod(bill, period).length;
}

/** What the bill adds up to in the period: its amount for each time it falls due. */
export function amountDueInPeriod(bill: ScheduledBill & { amount: number }, period: Period): number {
  return Math.round(bill.amount * occurrencesInPeriod(bill, period) * 100) / 100;
}

/** The first date the bill falls due in the period, or null (no fixed day, or not due). */
export function nextDueDate(bill: ScheduledBill, period: Period): Date | null {
  return dueDatesInPeriod(bill, period).find((d): d is Date => d !== null) ?? null;
}
