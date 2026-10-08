import { describe, expect, it } from 'vitest';
import { amountDueInPeriod, dueDatesInPeriod, nextDueDate, type Period, type ScheduledBill } from '../bill-schedule.js';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
// Payday on the 25th: 25 Sep to 24 Oct.
const period: Period = { start: utc('2026-09-25'), end: utc('2026-10-25') };
const monthly = (dueDay: number | null): ScheduledBill => ({ recurrence: 'MONTHLY', dueDay, dueDate: null });

describe('MONTHLY bills', () => {
  it('fall on their due day inside a period that spans two months', () => {
    expect(dueDatesInPeriod(monthly(1), period).map(iso)).toEqual(['2026-10-01']); // rent, after the new month
    expect(dueDatesInPeriod(monthly(26), period).map(iso)).toEqual(['2026-09-26']); // before it
    expect(dueDatesInPeriod(monthly(25), period).map(iso)).toEqual(['2026-09-25']); // on payday itself
    expect(dueDatesInPeriod(monthly(10), period).map(iso)).toEqual(['2026-10-10']);
  });

  it('clamp a day the month does not have', () => {
    const feb: Period = { start: utc('2027-01-25'), end: utc('2027-02-25') };
    expect(dueDatesInPeriod(monthly(31), feb).map(iso)).toEqual(['2027-01-31']);
    const mar: Period = { start: utc('2027-02-25'), end: utc('2027-03-25') };
    expect(dueDatesInPeriod(monthly(30), mar).map(iso)).toEqual(['2027-02-28']);
  });

  it('with no due day fall due once, without a date', () => {
    expect(dueDatesInPeriod(monthly(null), period)).toEqual([null]);
    expect(nextDueDate(monthly(null), period)).toBeNull();
  });

  it('add up to the amount once per period', () => {
    expect(amountDueInPeriod({ ...monthly(1), amount: 55000 }, period)).toBe(55000);
  });
});

describe('ONCE bills', () => {
  const once = (day: string): ScheduledBill => ({ recurrence: 'ONCE', dueDay: null, dueDate: utc(day) });

  it('fall due only in the period that holds their date', () => {
    expect(dueDatesInPeriod(once('2026-10-15'), period).map(iso)).toEqual(['2026-10-15']);
    expect(dueDatesInPeriod(once('2026-11-02'), period)).toEqual([]);
    expect(dueDatesInPeriod(once('2026-09-24'), period)).toEqual([]);
  });

  it('are not due without a date', () => {
    expect(dueDatesInPeriod({ recurrence: 'ONCE', dueDay: null, dueDate: null }, period)).toEqual([]);
  });

  it('count their amount once', () => {
    expect(amountDueInPeriod({ ...once('2026-10-15'), amount: 18500 }, period)).toBe(18500);
    expect(amountDueInPeriod({ ...once('2026-12-01'), amount: 18500 }, period)).toBe(0);
  });
});

describe('YEARLY bills', () => {
  const yearly = (day: string): ScheduledBill => ({ recurrence: 'YEARLY', dueDay: null, dueDate: utc(day) });

  it('fall due in the period that holds their month and day, any year', () => {
    expect(dueDatesInPeriod(yearly('2024-10-03'), period).map(iso)).toEqual(['2026-10-03']);
    expect(dueDatesInPeriod(yearly('2024-12-03'), period)).toEqual([]);
  });

  it('work across a year end', () => {
    const p: Period = { start: utc('2026-12-25'), end: utc('2027-01-25') };
    expect(dueDatesInPeriod(yearly('2020-01-05'), p).map(iso)).toEqual(['2027-01-05']);
    expect(dueDatesInPeriod(yearly('2020-12-30'), p).map(iso)).toEqual(['2026-12-30']);
  });
});

describe('WEEKLY bills', () => {
  // 2026-10-02 is a Friday.
  const weekly: ScheduledBill = { recurrence: 'WEEKLY', dueDay: null, dueDate: utc('2026-10-02') };

  it('fall on every matching weekday in the period, from their first date', () => {
    expect(dueDatesInPeriod(weekly, period).map(iso)).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']);
  });

  it('add up to the amount for each time', () => {
    expect(amountDueInPeriod({ ...weekly, amount: 4500 }, period)).toBe(18000);
  });

  it('do not fall before their first date', () => {
    const p: Period = { start: utc('2026-09-25'), end: utc('2026-10-25') };
    expect(dueDatesInPeriod({ ...weekly, dueDate: utc('2026-10-16') }, p).map(iso)).toEqual(['2026-10-16', '2026-10-23']);
  });
});
