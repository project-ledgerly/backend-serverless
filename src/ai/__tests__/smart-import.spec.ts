import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountLinkService, normaliseIdentifier } from '../account-link.service.js';
import { planBatch } from '../batch.planner.js';
import { buildSnapshot } from '../snapshot.builder.js';

const A = '11111111-1111-4111-8111-111111111111';
const S = '33333333-3333-4333-8333-333333333333';

describe('merchant and raw line on a planned transaction', () => {
  const ctx = {
    now: new Date('2026-10-15T00:00:00Z'),
    accounts: [{ id: A, name: 'Everyday' }],
    allowedAccountIds: [],
    sections: [{ id: S, name: 'Essentials', goal: null }],
    listings: [],
    existingTransactions: [],
    existingTransfers: [],
  };

  it('keeps them, trimmed, and leaves them null when not given', () => {
    const plan = planBatch(
      [
        {
          accountId: A,
          date: '2026-09-29',
          amount: -260,
          description: 'Groceries',
          sectionId: S,
          merchant: '  P&S Kollupitiya ',
          raw: 'POS P - S - KOLLUPITIYA -  RA 80504494',
        },
        { accountId: A, date: '2026-09-30', amount: -130, description: 'Other', sectionId: S },
      ],
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.transactions[0]).toMatchObject({ merchant: 'P&S Kollupitiya', raw: 'POS P - S - KOLLUPITIYA -  RA 80504494' });
    expect(plan.transactions[1]).toMatchObject({ merchant: null, raw: null });
  });
});

describe('snapshot', () => {
  it('shows how the bank prints each account, and the merchant on recent transactions', () => {
    const s = buildSnapshot({
      now: new Date('2026-10-15T00:00:00Z'),
      user: { name: 'Sam', currency: 'LKR' },
      accounts: [{ id: A, name: 'Everyday', type: 'SPENDING', balance: 10, identifiers: ['122452836108'] }],
      incomes: [],
      plan: null,
      sections: [],
      listings: [],
      goals: [],
      monthTransactions: [],
      recentTransactions: [
        { id: 't', date: new Date('2026-10-01T00:00:00Z'), amount: -5, description: 'Groceries', accountId: A, sectionId: S, listingId: null, merchant: 'P&S' },
      ],
      allowedAccountIds: [],
    });
    expect(s.accounts[0]?.identifiers).toEqual(['122452836108']);
    expect(s.recentTransactions[0]?.merchant).toBe('P&S');
  });
});

/** A stand-in for the two Prisma calls AccountLinkService makes. */
function service(accounts: Array<{ id: string; name: string; identifiers: string[] }>) {
  const prisma: any = {
    account: {
      findMany: async () => accounts,
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id)!;
        a.identifiers = [...a.identifiers, ...data.identifiers.push.split('\u0000')];
        return a;
      },
    },
  };
  return new AccountLinkService(prisma);
}

describe('AccountLinkService', () => {
  it('ignores spaces, dashes and case when comparing', () => {
    expect(normaliseIdentifier('1224-5283 6108')).toBe('122452836108');
    expect(normaliseIdentifier('AB 12')).toBe('ab12');
  });

  it('links a number to an account', async () => {
    const accounts = [{ id: 'a1', name: 'Everyday', identifiers: [] as string[] }];
    const result = await service(accounts).link('u1', 'a1', '122452836108');
    expect(result.identifiers).toEqual(['122452836108']);
  });

  it('is a no-op when already linked, even written differently', async () => {
    const accounts = [{ id: 'a1', name: 'Everyday', identifiers: ['122452836108'] }];
    const result = await service(accounts).link('u1', 'a1', '1224 5283 6108');
    expect(result.identifiers).toEqual(['122452836108']);
  });

  it('refuses a number already on another account of the same user', async () => {
    const accounts = [
      { id: 'a1', name: 'Everyday', identifiers: ['122452836108'] },
      { id: 'a2', name: 'Rainy Day', identifiers: [] as string[] },
    ];
    await expect(service(accounts).link('u1', 'a2', '122452836108')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an account that is not the user\'s, and a too-short value', async () => {
    const accounts = [{ id: 'a1', name: 'Everyday', identifiers: [] as string[] }];
    await expect(service(accounts).link('u1', 'other', '122452836108')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service(accounts).link('u1', 'a1', '12')).rejects.toThrow('at least 4');
  });
});
