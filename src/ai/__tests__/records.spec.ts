import { describe, expect, it } from 'vitest';
import { planBatch, type PlannerContext } from '../batch.planner.js';
import { Effects } from '../effects.js';

describe('Effects', () => {
  it('a transaction and its removal cancel out exactly', () => {
    const e = new Effects();
    const goal = { id: 'g1', mode: 'TARGET' };
    e.transaction({ accountId: 'a1', cents: -1250, goal }, 1);
    e.transaction({ accountId: 'a1', cents: -1250, goal }, -1);
    expect(e.accounts.get('a1')).toBe(0);
    expect(e.goals.get('g1')).toBe(0);
    expect(e.accountChanges(new Map([['a1', 'Everyday']]))).toEqual([]);
  });

  it('moves the goal with a transaction, but not a reserve', () => {
    const e = new Effects();
    e.transaction({ accountId: 'a1', cents: 500, goal: { id: 'g1', mode: 'TARGET' } }, 1);
    e.transaction({ accountId: 'a1', cents: 700, goal: { id: 'g2', mode: 'RESERVE' } }, 1);
    expect(e.accounts.get('a1')).toBe(1200);
    expect(e.goals.get('g1')).toBe(500);
    expect(e.goals.has('g2')).toBe(false);
  });

  it('a transfer moves both accounts, and the goal it pays into', () => {
    const e = new Effects();
    e.transfer({ fromAccountId: 'a1', toAccountId: 'a2', cents: 3000, goalId: 'g1' }, 1);
    expect(e.accounts.get('a1')).toBe(-3000);
    expect(e.accounts.get('a2')).toBe(3000);
    expect(e.goals.get('g1')).toBe(3000);
    e.transfer({ fromAccountId: 'a1', toAccountId: 'a2', cents: 3000, goalId: 'g1' }, -1);
    expect([e.accounts.get('a1'), e.accounts.get('a2'), e.goals.get('g1')]).toEqual([0, 0, 0]);
  });

  it('an edit is "take the old one away, add the new one"', () => {
    const e = new Effects();
    // moved from account a1 / -5,050 to account a1 / -505 and from goal section to none
    e.transaction({ accountId: 'a1', cents: -505000, goal: { id: 'g1', mode: 'TARGET' } }, -1);
    e.transaction({ accountId: 'a1', cents: -50500, goal: null }, 1);
    expect(e.accounts.get('a1')).toBe(505000 - 50500);
    expect(e.goals.get('g1')).toBe(505000);
  });

  it('sums cents, so many small amounts do not drift', () => {
    const e = new Effects();
    for (let i = 0; i < 10; i++) e.transaction({ accountId: 'a1', cents: -10, goal: null }, 1);
    expect(e.accounts.get('a1')).toBe(-100);
  });
});

const A = '11111111-1111-4111-8111-111111111111';
const S_ESS = '33333333-3333-4333-8333-333333333333';
const S_GOAL = '44444444-4444-4444-8444-444444444444';

function ctx(over: Partial<PlannerContext> = {}): PlannerContext {
  return {
    now: new Date('2026-10-15T00:00:00Z'),
    accounts: [{ id: A, name: 'Everyday' }],
    allowedAccountIds: [],
    sections: [
      { id: S_ESS, name: 'Essentials', goal: null },
      { id: S_GOAL, name: 'Life Savings', goal: { id: 'g1', mode: 'TARGET' } },
    ],
    listings: [],
    existingTransactions: [],
    existingTransfers: [],
    ...over,
  };
}

describe('importer: possible duplicates', () => {
  const manual = { id: 'm1', accountId: A, date: new Date('2026-09-27T00:00:00Z'), cents: -505000, description: 'chicken', source: 'manual' };

  it('flags the same amount a day apart, described differently, without skipping it', () => {
    const plan = planBatch(
      [{ accountId: A, date: '2026-09-28', amount: -5050, description: 'Miriswaththa Farm Shop', sectionId: S_ESS }],
      ctx({ existingTransactions: [manual] }),
    );
    expect(plan.transactions).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.possibleDuplicates).toEqual([
      { row: 0, description: 'Miriswaththa Farm Shop', existing: { id: 'm1', date: '2026-09-27', description: 'chicken', source: 'manual' } },
    ]);
  });

  it('does not flag a different amount, another account, or something a week away', () => {
    const rows = (over: object) => [{ accountId: A, date: '2026-09-28', amount: -5050, description: 'x', sectionId: S_ESS, ...over }];
    expect(planBatch(rows({ amount: -5051 }), ctx({ existingTransactions: [manual] })).possibleDuplicates).toEqual([]);
    expect(planBatch(rows({}), ctx({ existingTransactions: [{ ...manual, accountId: 'other' }] })).possibleDuplicates).toEqual([]);
    expect(planBatch(rows({ date: '2026-10-08' }), ctx({ existingTransactions: [manual] })).possibleDuplicates).toEqual([]);
  });

  it('offers each existing entry to only one new row', () => {
    const plan = planBatch(
      [
        { accountId: A, date: '2026-09-28', amount: -5050, description: 'a', sectionId: S_ESS },
        { accountId: A, date: '2026-09-28', amount: -5050, description: 'b', sectionId: S_ESS },
      ],
      ctx({ existingTransactions: [manual] }),
    );
    expect(plan.possibleDuplicates).toHaveLength(1);
  });
});

describe('importer: goal sections', () => {
  it('warns when a purchase is filed under a goal, but not a deposit into it', () => {
    const plan = planBatch(
      [
        { accountId: A, date: '2026-09-28', amount: -260, description: 'Groceries', sectionId: S_GOAL },
        { accountId: A, date: '2026-09-29', amount: 500, description: 'Top up', sectionId: S_GOAL },
      ],
      ctx(),
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('rows[0]');
    expect(plan.warnings[0]).toContain('Life Savings');
    expect(plan.warnings[0]).toContain('lowers that goal');
  });

  it('is quiet for a normal spending section', () => {
    const plan = planBatch([{ accountId: A, date: '2026-09-28', amount: -260, description: 'Groceries', sectionId: S_ESS }], ctx());
    expect(plan.warnings).toEqual([]);
  });
});
