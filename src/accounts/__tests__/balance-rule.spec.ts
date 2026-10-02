import { describe, expect, it, vi } from 'vitest';
import { planBatch, type PlannerContext } from '../../ai/batch.planner.js';
import type { BatchRowDto } from '../../ai/dto/log-batch.dto.js';
import { TransactionsService } from '../../transactions/transactions.service.js';
import { movesBalance, today } from '../balance-rule.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('movesBalance', () => {
  it('everything moves the balance until one has been stated', () => {
    expect(movesBalance(null, d('2020-01-01'))).toBe(true);
    expect(movesBalance(undefined, d('2020-01-01'))).toBe(true);
  });

  it('entries before the stated day are already inside it; that day and later move it', () => {
    const asOf = d('2026-10-03');
    expect(movesBalance(asOf, d('2026-10-02'))).toBe(false);
    expect(movesBalance(asOf, new Date('2026-10-03T00:00:00Z'))).toBe(true);
    expect(movesBalance(asOf, new Date('2026-10-03T23:59:00Z'))).toBe(true);
    expect(movesBalance(asOf, d('2026-10-04'))).toBe(true);
  });

  it("today() is a UTC day, so a stated balance keeps the whole of today's entries counting", () => {
    expect(today(new Date('2026-10-03T17:45:00Z')).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

/** In-memory Prisma: just the calls TransactionsService makes, recording balance updates. */
function fakeService(asOf: Date | null, existing?: { amount: number; date: string }) {
  const balanceCalls: Array<{ id: string; data: any }> = [];
  const account = { id: 'a1', userId: 'u1', balance: 0, balanceAsOf: asOf };
  const section = { id: 's1', protected: false, goal: null };
  const row = existing
    ? { id: 't1', userId: 'u1', accountId: 'a1', sectionId: 's1', amount: { toString: () => String(existing.amount), negated: () => -existing.amount, valueOf: () => existing.amount }, date: d(existing.date), listingId: null }
    : null;
  const prisma = {
    account: {
      findUnique: async () => account,
      findUniqueOrThrow: async () => account,
      update: (args: any) => {
        balanceCalls.push({ id: args.where.id, data: args.data });
        return Promise.resolve({});
      },
    },
    section: { findUnique: async () => section },
    transaction: {
      create: async (args: any) => ({ id: 't-new', ...args.data }),
      findUnique: async () => row,
      update: async (args: any) => ({ ...row, ...args.data }),
      delete: async () => ({}),
    },
    goal: { update: vi.fn() },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  } as any;
  return { svc: new TransactionsService(prisma), balanceCalls };
}

const create = (svc: TransactionsService, date: string, amount = '-40') =>
  svc.create({ userId: 'u1', accountId: 'a1', sectionId: 's1', amount, description: 'Lunch', date, source: 'manual' } as never);

describe('TransactionsService follows the balance rule', () => {
  it('a normal entry moves the balance', async () => {
    const { svc, balanceCalls } = fakeService(null);
    await create(svc, '2026-09-20');
    expect(balanceCalls).toHaveLength(1);
    expect(balanceCalls[0]!.data.balance).toEqual({ increment: '-40' });
  });

  it('an entry dated before the stated balance is saved but does not move it', async () => {
    const { svc, balanceCalls } = fakeService(d('2026-10-03'));
    const tx = await create(svc, '2026-10-01');
    expect(tx.description).toBe('Lunch');
    expect(balanceCalls).toHaveLength(0);
  });

  it('an entry dated the stated day or later does move it', async () => {
    const { svc, balanceCalls } = fakeService(d('2026-10-03'));
    await create(svc, '2026-10-03');
    await create(svc, '2026-10-04');
    expect(balanceCalls).toHaveLength(2);
  });

  it('deleting an old entry does not give the money back a second time', async () => {
    const { svc, balanceCalls } = fakeService(d('2026-10-03'), { amount: -40, date: '2026-10-01' });
    await svc.remove('t1');
    expect(balanceCalls).toHaveLength(0);
  });

  it('deleting a recent entry reverses it', async () => {
    const { svc, balanceCalls } = fakeService(d('2026-10-03'), { amount: -40, date: '2026-10-05' });
    await svc.remove('t1');
    expect(balanceCalls).toHaveLength(1);
    expect(balanceCalls[0]!.data.balance).toHaveProperty('decrement');
  });

  it('moving an entry across the line changes the balance by the right amount', async () => {
    // Was after the line (counted); now dated before it (already in the balance): take it out once.
    const a = fakeService(d('2026-10-03'), { amount: -40, date: '2026-10-05' });
    await a.svc.update('t1', { date: '2026-10-01' } as never);
    expect(a.balanceCalls.map((c) => Object.keys(c.data.balance)[0])).toEqual(['decrement']);
    // Was before the line; now after it: bring it in once.
    const b = fakeService(d('2026-10-03'), { amount: -40, date: '2026-10-01' });
    await b.svc.update('t1', { date: '2026-10-06' } as never);
    expect(b.balanceCalls.map((c) => Object.keys(c.data.balance)[0])).toEqual(['increment']);
  });
});

describe('batch planner and the balance rule', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const S = '33333333-3333-4333-8333-333333333333';
  const ctx = (asOf: Date | null): PlannerContext => ({
    now: new Date('2026-10-04T00:00:00Z'),
    accounts: [{ id: A, name: 'Everyday', balanceAsOf: asOf }],
    allowedAccountIds: [],
    sections: [{ id: S, name: 'Essentials', goal: null }],
    listings: [],
    existingTransactions: [],
    existingTransfers: [],
  });
  const row = (date: string, amount: number, description: string): BatchRowDto => ({ accountId: A, date, amount, description, sectionId: S });

  it('only rows dated on or after the stated day change the account total', () => {
    const plan = planBatch([row('2026-09-30', -100, 'Old'), row('2026-10-02', -50, 'Old too'), row('2026-10-03', -30, 'New'), row('2026-10-04', -20, 'Newer')], ctx(d('2026-10-03')));
    expect(plan.transactions).toHaveLength(4);
    expect(plan.accountDeltas.get(A)).toBe(-5000);
  });

  it('with no stated balance every row moves it', () => {
    const plan = planBatch([row('2026-09-30', -100, 'Old'), row('2026-10-03', -30, 'New')], ctx(null));
    expect(plan.accountDeltas.get(A)).toBe(-13000);
  });
});
