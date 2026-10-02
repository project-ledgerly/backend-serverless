// What a change to transactions and transfers does to account balances and
// goal totals, in whole cents. Everything the AI tools can do to a record is
// "add it" (+1) or "take it away" (-1), so this one accumulator serves
// logging, deleting, editing and undoing, and they can't drift apart.

import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export const toCents = (amount: number) => Math.round(amount * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

export interface GoalRef {
  id: string;
  mode: string;
}

export class Effects {
  readonly accounts = new Map<string, number>();
  readonly goals = new Map<string, number>();

  private bump(map: Map<string, number>, id: string, cents: number) {
    map.set(id, (map.get(id) ?? 0) + cents);
  }

  /** sign +1 = the transaction now exists, -1 = it no longer does. */
  transaction(row: { accountId: string; cents: number; goal: GoalRef | null }, sign: 1 | -1) {
    this.bump(this.accounts, row.accountId, sign * row.cents);
    // A reserve goal watches an account balance and has no running total.
    if (row.goal && row.goal.mode !== 'RESERVE') this.bump(this.goals, row.goal.id, sign * row.cents);
  }

  transfer(row: { fromAccountId: string; toAccountId: string; cents: number; goalId: string | null }, sign: 1 | -1) {
    this.bump(this.accounts, row.fromAccountId, -sign * row.cents);
    this.bump(this.accounts, row.toAccountId, sign * row.cents);
    if (row.goalId) this.bump(this.goals, row.goalId, sign * row.cents);
  }

  /** One update per account and per goal that actually changed. */
  ops(prisma: PrismaService): Prisma.PrismaPromise<unknown>[] {
    return [
      ...[...this.accounts.entries()]
        .filter(([, cents]) => cents !== 0)
        .map(([id, cents]) => prisma.account.update({ where: { id }, data: { balance: { increment: fromCents(cents) } } })),
      ...[...this.goals.entries()]
        .filter(([, cents]) => cents !== 0)
        .map(([id, cents]) => prisma.goal.update({ where: { id }, data: { currentAmount: { increment: fromCents(cents) } } })),
    ];
  }

  /** Account changes as numbers, for reporting back. */
  accountChanges(names: Map<string, string>) {
    return [...this.accounts.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([id, cents]) => ({ account: names.get(id) ?? id, change: Number(fromCents(cents)) }));
  }
}
