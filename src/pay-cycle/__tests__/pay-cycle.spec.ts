import { describe, expect, it } from 'vitest';
import { calendarCycle, payCycleContaining, primaryIncome, recentPayCycles, type CycleIncome } from '../pay-cycle.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const monthly = (next: string, amount = 80000): CycleIncome => ({ amount, recurring: true, frequency: 'MONTHLY', nextRunDate: d(next) });

describe('payCycleContaining (salary on the 28th)', () => {
  const salary = [monthly('2026-10-28')];

  it('before the 28th, the period began last month', () => {
    const c = payCycleContaining(d('2026-10-03'), salary);
    expect([iso(c.start), iso(c.end), c.basis]).toEqual(['2026-09-28', '2026-10-28', 'payday']);
  });

  it('on payday the new period starts that day', () => {
    const c = payCycleContaining(d('2026-10-28'), salary);
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-10-28', '2026-11-28']);
  });

  it('the day before payday is still the old period', () => {
    const c = payCycleContaining(d('2026-10-27'), salary);
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-09-28', '2026-10-28']);
  });

  it('crosses the year', () => {
    const c = payCycleContaining(d('2027-01-05'), salary);
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-12-28', '2027-01-28']);
  });

  it('does not depend on whether nextRunDate has moved on yet', () => {
    const stale = [monthly('2026-08-28')];
    const c = payCycleContaining(d('2026-10-03'), stale);
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-09-28', '2026-10-28']);
  });
});

describe('short months', () => {
  it('a payday on the 31st lands on the last day of shorter months', () => {
    const salary = [monthly('2026-10-31')];
    expect(iso(payCycleContaining(d('2026-11-30'), salary).start)).toBe('2026-11-30');
    expect(iso(payCycleContaining(d('2026-11-29'), salary).start)).toBe('2026-10-31');
    expect(iso(payCycleContaining(d('2027-03-01'), salary).start)).toBe('2027-02-28');
  });
});

describe('weekly and fortnightly', () => {
  it('steps back and forward from the next payday', () => {
    const weekly: CycleIncome[] = [{ amount: 100, recurring: true, frequency: 'WEEKLY', nextRunDate: d('2026-10-09') }];
    const c = payCycleContaining(d('2026-10-03'), weekly);
    expect([iso(c.start), iso(c.end)]).toEqual(['2026-10-02', '2026-10-09']);
    const bi: CycleIncome[] = [{ amount: 100, recurring: true, frequency: 'BIWEEKLY', nextRunDate: d('2026-10-09') }];
    const b = payCycleContaining(d('2026-10-03'), bi);
    expect([iso(b.start), iso(b.end)]).toEqual(['2026-09-25', '2026-10-09']);
  });
});

describe('which income sets the rhythm', () => {
  it('prefers the largest monthly one', () => {
    const big = monthly('2026-10-28', 80000);
    const small = monthly('2026-10-05', 5000);
    expect(primaryIncome([small, big])).toBe(big);
  });

  it('falls back to a weekly income when there is no monthly one', () => {
    const w: CycleIncome = { amount: 100, recurring: true, frequency: 'WEEKLY', nextRunDate: d('2026-10-09') };
    expect(primaryIncome([w])).toBe(w);
  });

  it('ignores one-off, yearly and undated income, and uses the calendar month', () => {
    const none: CycleIncome[] = [
      { amount: 999, recurring: false, frequency: null, nextRunDate: null },
      { amount: 999, recurring: true, frequency: 'YEARLY', nextRunDate: d('2027-01-01') },
      { amount: 999, recurring: true, frequency: 'MONTHLY', nextRunDate: null },
    ];
    expect(primaryIncome(none)).toBeNull();
    const c = payCycleContaining(d('2026-10-03'), none);
    expect([iso(c.start), iso(c.end), c.basis]).toEqual(['2026-10-01', '2026-11-01', 'calendar']);
    expect(iso(calendarCycle(d('2026-12-15')).end)).toBe('2027-01-01');
  });
});

describe('recentPayCycles', () => {
  it('returns consecutive periods, oldest first, ending with the current one', () => {
    const list = recentPayCycles(d('2026-10-03'), [monthly('2026-10-28')], 4);
    expect(list.map((c) => iso(c.start))).toEqual(['2026-06-28', '2026-07-28', '2026-08-28', '2026-09-28']);
    for (let i = 1; i < list.length; i++) expect(list[i]!.start.getTime()).toBe(list[i - 1]!.end.getTime());
  });
});
