import { describe, expect, it } from 'vitest';
import { describeErrors, planBatch, type PlannerContext } from '../batch.planner.js';
import type { BatchRowDto } from '../dto/log-batch.dto.js';

const A_MAIN = '11111111-1111-4111-8111-111111111111';
const A_SAVE = '22222222-2222-4222-8222-222222222222';
const A_OTHER = '99999999-9999-4999-8999-999999999999';
const S_ESS = '33333333-3333-4333-8333-333333333333';
const S_GOAL = '44444444-4444-4444-8444-444444444444';
const S_RESERVE = '55555555-5555-4555-8555-555555555555';
const L_RENT = '66666666-6666-4666-8666-666666666666';

function ctx(over: Partial<PlannerContext> = {}): PlannerContext {
  return {
    now: new Date('2026-10-15T00:00:00Z'),
    accounts: [
      { id: A_MAIN, name: 'Everyday' },
      { id: A_SAVE, name: 'Rainy Day' },
    ],
    allowedAccountIds: [],
    sections: [
      { id: S_ESS, name: 'Essentials', goal: null },
      { id: S_GOAL, name: 'Japan', goal: { id: 'g-japan', mode: 'TARGET' } },
      { id: S_RESERVE, name: 'Buffer', goal: { id: 'g-buffer', mode: 'RESERVE' } },
    ],
    listings: [{ id: L_RENT, name: 'Rent', sectionId: S_ESS }],
    existingTransactions: [],
    existingTransfers: [],
    ...over,
  };
}

const spend = (over: Partial<BatchRowDto> = {}): BatchRowDto => ({
  accountId: A_MAIN,
  date: '2026-10-03',
  amount: -12.5,
  description: 'Lunch',
  sectionId: S_ESS,
  ...over,
});

describe('planBatch: transactions', () => {
  it('plans a spend and moves the account by the same amount', () => {
    const plan = planBatch([spend()], ctx());
    expect(plan.errors).toEqual([]);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]).toMatchObject({ accountId: A_MAIN, sectionId: S_ESS, cents: -1250, description: 'Lunch' });
    expect(plan.accountDeltas.get(A_MAIN)).toBe(-1250);
  });

  it('adds up many rows per account without float drift', () => {
    const rows = Array.from({ length: 10 }, (_, i) => spend({ amount: -0.1, description: `Item ${i}` }));
    expect(planBatch(rows, ctx()).accountDeltas.get(A_MAIN)).toBe(-100);
  });

  it('takes the section from the bill when only a bill is given', () => {
    const plan = planBatch([spend({ sectionId: undefined, listingId: L_RENT, description: 'Rent', amount: -800 })], ctx());
    expect(plan.errors).toEqual([]);
    expect(plan.transactions[0]).toMatchObject({ sectionId: S_ESS, listingId: L_RENT });
  });

  it('moves a goal section\'s saved amount, but not a reserve\'s', () => {
    const plan = planBatch(
      [spend({ sectionId: S_GOAL, amount: 200, description: 'Top up' }), spend({ sectionId: S_RESERVE, amount: 50, description: 'x' })],
      ctx(),
    );
    expect(plan.goalDeltas.get('g-japan')).toBe(20000);
    expect(plan.goalDeltas.has('g-buffer')).toBe(false);
  });

  it('reports every problem with its row number, and plans nothing usable', () => {
    const plan = planBatch(
      [
        spend({ accountId: A_OTHER }),
        spend({ amount: 0 }),
        spend({ sectionId: undefined }),
        spend({ date: '1990-01-01' }),
        spend({ date: '2030-01-01' }),
        spend({ listingId: L_RENT, sectionId: S_GOAL }),
        spend({ toAccountId: A_SAVE, type: 'transaction' }),
      ],
      ctx(),
    );
    expect(plan.errors).toHaveLength(7);
    expect(plan.errors[0]).toContain('rows[0]');
    expect(plan.errors[0]).toContain('not one of your accounts');
    expect(plan.errors[1]).toContain('amount cannot be 0');
    expect(plan.errors[2]).toContain('sectionId is required');
    expect(plan.errors[3]).toContain('not a sensible date');
    expect(plan.errors[4]).toContain('not a sensible date');
    expect(plan.errors[5]).toContain('different section');
    expect(plan.errors[6]).toContain('only for transfers');
    expect(describeErrors(plan.errors)).toMatch(/^Nothing was logged\. 7 problems: rows\[0\]/);
  });
});

describe('planBatch: transfers', () => {
  const move = (over: Partial<BatchRowDto> = {}): BatchRowDto => ({
    accountId: A_MAIN,
    toAccountId: A_SAVE,
    date: '2026-10-04',
    amount: 300,
    description: 'To savings',
    ...over,
  });

  it('is a transfer as soon as it has a toAccountId, and moves both balances', () => {
    const plan = planBatch([move()], ctx());
    expect(plan.errors).toEqual([]);
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transactions).toHaveLength(0);
    expect(plan.accountDeltas.get(A_MAIN)).toBe(-30000);
    expect(plan.accountDeltas.get(A_SAVE)).toBe(30000);
  });

  it('adds to a goal when tagged to one, and refuses a reserve or a missing goal', () => {
    expect(planBatch([move({ goalSectionId: S_GOAL })], ctx()).goalDeltas.get('g-japan')).toBe(30000);
    expect(planBatch([move({ goalSectionId: S_RESERVE })], ctx()).errors[0]).toContain('no goal');
    expect(planBatch([move({ goalSectionId: S_ESS })], ctx()).errors[0]).toContain('no goal');
  });

  it('rejects the same account, a negative amount, and a missing destination', () => {
    expect(planBatch([move({ toAccountId: A_MAIN })], ctx()).errors[0]).toContain('two different accounts');
    expect(planBatch([move({ amount: -5 })], ctx()).errors[0]).toContain('must be positive');
    expect(planBatch([move({ toAccountId: undefined, type: 'transfer' })], ctx()).errors[0]).toContain('needs toAccountId');
  });
});

describe('planBatch: duplicates', () => {
  it('skips a row that already exists, whoever entered it', () => {
    const plan = planBatch(
      [spend({ description: '  LUNCH  ' })],
      ctx({ existingTransactions: [{ accountId: A_MAIN, date: new Date('2026-10-03T00:00:00Z'), cents: -1250, description: 'lunch' }] }),
    );
    expect(plan.transactions).toHaveLength(0);
    expect(plan.skipped).toEqual([{ row: 0, reason: 'duplicate of a transaction already logged', description: 'LUNCH' }]);
    expect(plan.accountDeltas.size).toBe(0);
  });

  it('keeps two identical purchases in one batch, but only as many as are missing', () => {
    const rows = [spend(), spend(), spend()];
    expect(planBatch(rows, ctx()).transactions).toHaveLength(3);
    const one = ctx({ existingTransactions: [{ accountId: A_MAIN, date: new Date('2026-10-03T00:00:00Z'), cents: -1250, description: 'Lunch' }] });
    const plan = planBatch(rows, one);
    expect(plan.transactions).toHaveLength(2);
    expect(plan.skipped).toHaveLength(1);
  });

  it('sees a different day, amount or account as a different transaction', () => {
    const existing = ctx({ existingTransactions: [{ accountId: A_MAIN, date: new Date('2026-10-03T00:00:00Z'), cents: -1250, description: 'Lunch' }] });
    expect(planBatch([spend({ date: '2026-10-04' })], existing).transactions).toHaveLength(1);
    expect(planBatch([spend({ amount: -12.51 })], existing).transactions).toHaveLength(1);
    expect(planBatch([spend({ accountId: A_SAVE })], existing).transactions).toHaveLength(1);
  });

  it('skips a transfer that is already logged', () => {
    const plan = planBatch(
      [{ accountId: A_MAIN, toAccountId: A_SAVE, date: '2026-10-04', amount: 300, description: 'again' }],
      ctx({ existingTransfers: [{ fromAccountId: A_MAIN, toAccountId: A_SAVE, date: new Date('2026-10-04T00:00:00Z'), cents: 30000 }] }),
    );
    expect(plan.transfers).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toContain('transfer');
  });
});

describe('planBatch: token limits', () => {
  it('refuses accounts the token was not given, on either side of a transfer', () => {
    const limited = ctx({ allowedAccountIds: [A_MAIN] });
    expect(planBatch([spend({ accountId: A_SAVE })], limited).errors[0]).toContain('not allowed to use the account "Rainy Day"');
    const plan = planBatch([{ accountId: A_MAIN, toAccountId: A_SAVE, date: '2026-10-04', amount: 5, description: 'x' }], limited);
    expect(plan.errors[0]).toContain('Rainy Day');
    expect(planBatch([spend()], limited).errors).toEqual([]);
  });
});
