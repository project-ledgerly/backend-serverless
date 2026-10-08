import { describe, expect, it } from 'vitest';
import { goalHistoryEnds } from '../goals.service.js';

const monthly = (day: string) => ({ amount: 185000, recurring: true, frequency: 'MONTHLY', nextRunDate: new Date(day) });
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('goalHistoryEnds', () => {
  it('ends each trend point on a payday, newest last', () => {
    const ends = goalHistoryEnds(new Date('2026-10-08T10:00:00Z'), [monthly('2026-10-25')]);
    expect(ends.map(iso)).toEqual(['2026-05-25', '2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25', '2026-10-25']);
  });

  it('puts a payday contribution in the period it belongs to', () => {
    // Saved on payday 25 Sep: that belongs to the period starting 25 Sep, not the one before it.
    const ends = goalHistoryEnds(new Date('2026-10-08T10:00:00Z'), [monthly('2026-10-25')]);
    const savedOn = new Date('2026-09-25T00:00:00Z');
    expect(savedOn < ends[4]).toBe(false); // not in the period that ended on 25 Sep
    expect(savedOn < ends[5]).toBe(true); // in the current period
  });

  it('is calendar months with no recurring salary', () => {
    const ends = goalHistoryEnds(new Date('2026-10-08T10:00:00Z'), []);
    expect(ends.map(iso)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
  });
});
