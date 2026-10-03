import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../snapshot.builder.js';
import { parseOp, parseOps } from '../plan-ops.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseOp', () => {
  it('reads a section with a percentage, and one that takes the remainder', () => {
    expect(parseOp({ op: 'add_section', ref: 'holiday', name: 'Holiday', type: 'GOAL', percentage: 8 })).toMatchObject({
      op: 'add_section',
      ref: 'holiday',
      percentage: 8,
      remainder: false,
    });
    expect(parseOp({ op: 'add_section', name: 'Flexible', type: 'FLEXIBLE', remainder: true })).toMatchObject({ remainder: true });
  });

  it('says what is missing or wrong, by field', () => {
    expect(() => parseOp({ op: 'add_section', name: 'X', type: 'FLEXIBLE' })).toThrow('percentage is required unless remainder is true');
    expect(() => parseOp({ op: 'add_section', name: 'X', type: 'FLEXIBLE', percentage: 30, remainder: true })).toThrow('remainder section takes whatever is left');
    expect(() => parseOp({ op: 'add_section', name: 'X', type: 'NOPE', percentage: 5 })).toThrow('type must be one of ESSENTIAL, FLEXIBLE, SAVINGS, GOAL');
    expect(() => parseOp({ op: 'add_section', name: 'X', type: 'GOAL', percentage: 150 })).toThrow('percentage must be at most 100');
    expect(() => parseOp({ op: 'add_bill', section: ID, name: 'Rent', amount: -5 })).toThrow('amount must be at least 0.01');
    expect(() => parseOp({ op: 'add_bill', section: ID, name: 'Rent', amount: 10.123 })).toThrow('at most 2 decimals');
    expect(() => parseOp({ op: 'fly_to_moon' })).toThrow('op must be one of');
  });

  it('needs a target date for a TARGET goal (the default), but not for a reserve or monthly one', () => {
    expect(() => parseOp({ op: 'add_goal', section: ID, targetAmount: 5000 })).toThrow('targetDate is required for a TARGET goal');
    expect(parseOp({ op: 'add_goal', section: ID, targetAmount: 5000, targetDate: '2027-03-01' })).toMatchObject({ targetDate: '2027-03-01' });
    expect(parseOp({ op: 'add_goal', section: ID, mode: 'RESERVE', targetAmount: 3000 })).toMatchObject({ mode: 'RESERVE' });
    expect(parseOp({ op: 'add_goal', section: ID, mode: 'MONTHLY_RECURRING', targetAmount: 200 })).toMatchObject({ mode: 'MONTHLY_RECURRING' });
  });

  it('lets a bill\'s due day and a section\'s account be cleared with null', () => {
    expect(parseOp({ op: 'update_bill', bill: ID, dueDay: null })).toMatchObject({ dueDay: null });
    expect(parseOp({ op: 'update_section', section: ID, account: null, parent: null })).toMatchObject({ account: null, parent: null });
    expect(() => parseOp({ op: 'update_bill', bill: ID, dueDay: 40 })).toThrow('dueDay must be at most 31');
  });

  it('wants a frequency and a date for a recurring income', () => {
    expect(() => parseOp({ op: 'add_income', source: 'Salary', amount: 3000, account: ID, date: '2026-10-31' })).toThrow('frequency is required');
    expect(parseOp({ op: 'add_income', source: 'Salary', amount: 3000, account: ID, date: '2026-10-31', frequency: 'MONTHLY' })).toMatchObject({ frequency: 'MONTHLY' });
    expect(() => parseOp({ op: 'add_income', source: 'Salary', amount: 3000, account: ID, date: 'soon', frequency: 'MONTHLY' })).toThrow('must be a date');
  });

  it('keeps $name references as they are', () => {
    expect(parseOp({ op: 'add_bill', section: '$holiday', name: 'Flights', amount: 400 })).toMatchObject({ section: '$holiday' });
    expect(() => parseOp({ op: 'add_section', ref: 'my ref!', name: 'X', type: 'FLEXIBLE', remainder: true })).toThrow('short name');
  });
});

describe('parseOps', () => {
  it('collects every problem with its position, and rejects a ref used twice', () => {
    const { ops, errors } = parseOps([
      { op: 'add_section', ref: 'a', name: 'A', type: 'SAVINGS', percentage: 10 },
      { op: 'add_section', ref: 'a', name: 'B', type: 'SAVINGS', percentage: 10 },
      { op: 'add_bill', section: ID, name: 'Rent', amount: 0 },
      { op: 'nope' },
    ]);
    expect(ops).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('ops[1]');
    expect(errors[0]).toContain('used twice');
    expect(errors[1]).toContain('ops[2] (add_bill)');
    expect(errors[2]).toContain('ops[3] (nope)');
  });
});

describe('snapshot: income received', () => {
  const base = {
    now: new Date('2026-10-15T00:00:00Z'),
    user: { name: 'Sam', currency: 'LKR' },
    accounts: [
      { id: 'a1', name: 'Everyday', type: 'SPENDING', balance: 10 },
      { id: 'a2', name: 'Rainy Day', type: 'SAVINGS', balance: 5 },
    ],
    incomes: [],
    plan: null,
    sections: [],
    listings: [],
    goals: [],
    monthTransactions: [],
    recentTransactions: [],
    allowedAccountIds: [] as string[],
  };
  const receipts = [
    { id: 'r1', amount: 80000, date: new Date('2026-10-02T00:00:00Z'), accountId: 'a1', source: 'Consulting fee' },
    { id: 'r2', amount: 3500, date: new Date('2026-09-30T00:00:00Z'), accountId: 'a1', source: 'Salary' },
    { id: 'r3', amount: 200, date: new Date('2026-10-05T00:00:00Z'), accountId: 'a2', source: 'Gift' },
  ];

  it('totals this month\'s income apart from refunds, and lists the latest', () => {
    const s = buildSnapshot({ ...base, incomeReceipts: receipts });
    expect(s.thisPeriod.incomeReceived).toBe(80200);
    expect(s.recentIncome.map((r) => r.source)).toEqual(['Consulting fee', 'Salary', 'Gift']);
    expect(s.recentIncome[0]).toMatchObject({ account: 'Everyday', date: '2026-10-02', amount: 80000 });
  });

  it('only shows a limited token the income of its accounts', () => {
    const s = buildSnapshot({ ...base, incomeReceipts: receipts, allowedAccountIds: ['a2'] });
    expect(s.thisPeriod.incomeReceived).toBe(200);
    expect(s.recentIncome).toHaveLength(1);
  });

  it('is zero when nothing arrived', () => {
    expect(buildSnapshot(base).thisPeriod.incomeReceived).toBe(0);
  });
});
