/**
 * An account's balance can be stated as true on a given day (its balanceAsOf).
 * Everything dated before that day is already inside the figure, so it still
 * counts for spending and history but must not move the balance a second time.
 * Dated that day or later does move it. With no balanceAsOf, everything moves it.
 */
export const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function movesBalance(asOf: Date | null | undefined, date: Date): boolean {
  return !asOf || utcDay(date) >= utcDay(asOf);
}

/** Today as a UTC day, the value stored in balanceAsOf. */
export function today(now = new Date()): Date {
  return new Date(utcDay(now));
}
