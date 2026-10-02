import { describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotInput } from '../snapshot.builder.js';

const NOW = new Date('2026-10-15T10:00:00Z');

function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    now: NOW,
    user: { name: 'Sam', currency: 'LKR' },
    accounts: [
      { id: 'a-main', name: 'Everyday', type: 'SPENDING', balance: 1200 },
      { id: 'a-save', name: 'Rainy Day', type: 'SAVINGS', balance: 5000 },
    ],
    incomes: [
      { id: 'i1', source: 'Salary', amount: 3000, recurring: true, frequency: 'MONTHLY', nextRunDate: new Date('2026-10-31T00:00:00Z'), accountId: 'a-main' },
    ],
    plan: { id: 'p1', name: 'My Plan' },
    sections: [
      { id: 's-ess', parentId: null, name: 'Essentials', type: 'ESSENTIAL', allocationMode: 'PERCENTAGE', percentage: 50, accountId: 'a-main', protected: true, projectedAmount: 1500 },
      { id: 's-flex', parentId: null, name: 'Flexible', type: 'FLEXIBLE', allocationMode: 'REMAINDER', percentage: 0, accountId: null, protected: false, projectedAmount: 900 },
      { id: 's-goal', parentId: null, name: 'Japan trip', type: 'GOAL', allocationMode: 'PERCENTAGE', percentage: 20, accountId: 'a-save', protected: false, projectedAmount: 600 },
    ],
    listings: [
      { id: 'l-rent', sectionId: 's-ess', name: 'Rent', amount: 800, dueDay: 1 },
      { id: 'l-net', sectionId: 's-ess', name: 'Internet', amount: 60, dueDay: 10 },
    ],
    goals: [
      { id: 'g1', sectionId: 's-goal', mode: 'TARGET', targetAmount: 4000, currentAmount: 1000, startingAmount: 500, targetDate: new Date('2027-03-01T00:00:00Z') },
    ],
    monthTransactions: [
      { id: 't1', date: new Date('2026-10-01T00:00:00Z'), amount: -800, description: 'Rent Oct', accountId: 'a-main', sectionId: 's-ess', listingId: 'l-rent' },
      { id: 't2', date: new Date('2026-10-05T00:00:00Z'), amount: -40, description: 'Lunch', accountId: 'a-main', sectionId: 's-flex', listingId: null },
      { id: 't3', date: new Date('2026-10-06T00:00:00Z'), amount: 25, description: 'Refund', accountId: 'a-main', sectionId: 's-flex', listingId: null },
    ],
    recentTransactions: [
      { id: 't2', date: new Date('2026-10-05T00:00:00Z'), amount: -40, description: 'Lunch', accountId: 'a-main', sectionId: 's-flex', listingId: null },
    ],
    allowedAccountIds: [],
    ...over,
  };
}

describe('buildSnapshot', () => {
  it('sums this month by section, and splits money out from money in', () => {
    const s = buildSnapshot(input());
    expect(s.thisMonth).toEqual({ from: '2026-10-01', to: '2026-10-31', spent: 840, received: 25, incomeReceived: 0 });
    const flex = s.plan!.sections.find((x) => x.name === 'Flexible')!;
    expect(flex.spentThisMonth).toBe(40);
    expect(flex.receivedThisMonth).toBe(25);
    expect(flex.perPayday).toBe(900);
    expect(flex.allocation).toBe('remainder');
  });

  it('marks a bill paid by a linked expense, or an unlinked one in its section that names it', () => {
    const named = buildSnapshot(
      input({
        monthTransactions: [
          { id: 't9', date: new Date('2026-10-10T00:00:00Z'), amount: -60, description: 'Internet bill', accountId: 'a-main', sectionId: 's-ess', listingId: null },
          // Same words, wrong section: does not pay the bill.
          { id: 't8', date: new Date('2026-10-11T00:00:00Z'), amount: -5, description: 'Rent', accountId: 'a-main', sectionId: 's-flex', listingId: null },
          // Linked to a different bill: does not pay this one by name.
          { id: 't7', date: new Date('2026-10-12T00:00:00Z'), amount: -800, description: 'Rent', accountId: 'a-main', sectionId: 's-ess', listingId: 'l-net' },
        ],
      }),
    ).plan!.sections.find((x) => x.name === 'Essentials')!.bills;
    expect(named.find((b) => b.name === 'Internet')).toMatchObject({ paidThisMonth: true, paidAmount: 860 });
    expect(named.find((b) => b.name === 'Rent')).toMatchObject({ paidThisMonth: false });
  });

  it('marks a bill paid only when an expense is linked to it', () => {
    const bills = buildSnapshot(input()).plan!.sections.find((x) => x.name === 'Essentials')!.bills;
    expect(bills.find((b) => b.name === 'Rent')).toMatchObject({ paidThisMonth: true, paidAmount: 800, dueDay: 1 });
    expect(bills.find((b) => b.name === 'Internet')).toMatchObject({ paidThisMonth: false, paidAmount: 0 });
  });

  it('reports goal progress, and a reserve as the account balance against its floor', () => {
    const goal = buildSnapshot(input()).plan!.sections.find((x) => x.name === 'Japan trip')!.goal!;
    expect(goal).toMatchObject({ mode: 'TARGET', targetAmount: 4000, currentAmount: 1000, percentComplete: 25, targetDate: '2027-03-01' });

    const reserve = buildSnapshot(
      input({ goals: [{ id: 'g1', sectionId: 's-goal', mode: 'RESERVE', targetAmount: 3000, currentAmount: 0, startingAmount: 0, targetDate: null }] }),
    ).plan!.sections.find((x) => x.name === 'Japan trip')!.goal!;
    expect(reserve).toMatchObject({ mode: 'RESERVE', targetAmount: 3000, accountBalance: 5000 });
    expect(reserve).not.toHaveProperty('percentComplete');
  });

  it('names accounts, sections and bills on recent transactions', () => {
    const t = buildSnapshot(
      input({
        recentTransactions: [
          { id: 't1', date: new Date('2026-10-01T00:00:00Z'), amount: -800, description: 'Rent Oct', accountId: 'a-main', sectionId: 's-ess', listingId: 'l-rent' },
        ],
      }),
    ).recentTransactions[0];
    expect(t).toMatchObject({ account: 'Everyday', section: 'Essentials', bill: 'Rent', date: '2026-10-01' });
  });

  it('shows only the accounts a limited token may see, and says so', () => {
    const s = buildSnapshot(input({ allowedAccountIds: ['a-save'] }));
    expect(s.accounts.map((a) => a.name)).toEqual(['Rainy Day']);
    expect(s.limitedToAccounts).toEqual(['Rainy Day']);
    expect(s.incomes).toEqual([]);
    expect(s.thisMonth.spent).toBe(0);
    expect(s.recentTransactions).toEqual([]);
  });

  it('says nothing is limited for an unrestricted token', () => {
    const s = buildSnapshot(input());
    expect(s.limitedToAccounts).toBeNull();
    expect(s.accounts).toHaveLength(2);
    expect(s.incomes[0]).toMatchObject({ source: 'Salary', nextPayday: '2026-10-31', frequency: 'MONTHLY' });
  });

  it('copes with a user who has no plan yet', () => {
    const s = buildSnapshot(input({ plan: null, sections: [], listings: [], goals: [] }));
    expect(s.plan).toBeNull();
  });
});
