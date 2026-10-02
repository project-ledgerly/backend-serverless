// A copy of a user's plan structure (plan name, accounts, sections, bills,
// goals, incomes), and the means to put the live data back to a copy.
//
// Plan edits go through the normal services one step at a time, which are not
// atomic together. Taking a copy first means a half-applied edit can be rolled
// back, and the same copy is what undo restores. The structure is a few dozen
// rows, so copying all of it is cheap and far simpler than recording each step.

import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

type Row = Record<string, unknown> & { id: string };

export interface PlanSnapshot {
  plan: Row | null;
  accounts: Row[];
  sections: Row[];
  listings: Row[];
  goals: Row[];
  incomes: Row[];
}

const DATE_KEYS = new Set(['createdAt', 'date', 'nextRunDate', 'targetDate', 'currentPeriodStart']);

/** Rows as plain JSON: dates and decimals become strings, so they can be stored and compared. */
const plain = <T>(rows: T[]): Row[] => JSON.parse(JSON.stringify(rows)) as Row[];

/** Back to what Prisma wants to write: dates as Date, everything else as it is. */
function revive(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = DATE_KEYS.has(key) && typeof value === 'string' ? new Date(value) : value;
  }
  return out;
}

const withoutId = (row: Row) => {
  const { id: _id, ...rest } = revive(row);
  return rest;
};

export async function capturePlan(prisma: PrismaService, userId: string): Promise<PlanSnapshot> {
  const plan = await prisma.plan.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const [accounts, sections, listings, goals, incomes] = await Promise.all([
    prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.section.findMany({ where: { plan: { userId } }, orderBy: { id: 'asc' } }),
    prisma.listing.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.goal.findMany({ where: { section: { plan: { userId } } }, orderBy: { id: 'asc' } }),
    prisma.income.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  ]);
  return {
    plan: plan ? plain([plan])[0]! : null,
    accounts: plain(accounts),
    sections: plain(sections),
    listings: plain(listings),
    goals: plain(goals),
    incomes: plain(incomes),
  };
}

/** Sections with their parents before their children. */
function parentsFirst(sections: Row[]): Row[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const depth = (s: Row): number => {
    let d = 0;
    let cur: Row | undefined = s;
    while (cur && cur.parentId && byId.has(cur.parentId as string) && d < 50) {
      cur = byId.get(cur.parentId as string);
      d += 1;
    }
    return d;
  };
  return [...sections].sort((a, b) => depth(a) - depth(b));
}

const same = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Puts the user's plan structure back to `before`. Anything created since is
 * deleted, anything deleted since is created again, and anything changed is
 * set back, all in one transaction. Money (balances, transactions, receipts)
 * is never touched.
 *
 * It cannot remove a section or account that has gained transactions since;
 * that is reported plainly instead of failing obscurely.
 */
export async function restorePlan(prisma: PrismaService, userId: string, before: PlanSnapshot): Promise<void> {
  const now = await capturePlan(prisma, userId);

  const diff = (was: Row[], is: Row[]) => {
    const wasById = new Map(was.map((r) => [r.id, r]));
    const isById = new Map(is.map((r) => [r.id, r]));
    return {
      created: is.filter((r) => !wasById.has(r.id)), // exist now, did not before: delete
      deleted: was.filter((r) => !isById.has(r.id)), // existed before, gone now: create
      changed: was.filter((r) => isById.has(r.id) && !same(r, isById.get(r.id)!)),
    };
  };

  const accounts = diff(before.accounts, now.accounts);
  const sections = diff(before.sections, now.sections);
  const listings = diff(before.listings, now.listings);
  const goals = diff(before.goals, now.goals);
  const incomes = diff(before.incomes, now.incomes);

  // A section that is no longer a remainder must be changed before another one
  // becomes the remainder, or the one-remainder-per-group index objects.
  const nowSections = new Map(now.sections.map((s) => [s.id, s]));
  const demoting = sections.changed.filter((s) => nowSections.get(s.id)?.allocationMode === 'REMAINDER' && s.allocationMode !== 'REMAINDER');
  const otherSectionChanges = sections.changed.filter((s) => !demoting.includes(s));

  const ops: Prisma.PrismaPromise<unknown>[] = [
    // ---- remove what was added ----
    ...goals.created.map((g) => prisma.goalMonthSnapshot.deleteMany({ where: { goalId: g.id } })),
    ...goals.created.map((g) => prisma.goal.delete({ where: { id: g.id } })),
    ...listings.created.map((l) => prisma.listing.delete({ where: { id: l.id } })),
    ...parentsFirst(sections.created)
      .reverse()
      .map((s) => prisma.section.delete({ where: { id: s.id } })),
    ...incomes.created.map((i) => prisma.income.delete({ where: { id: i.id } })),
    ...accounts.created.map((a) => prisma.account.delete({ where: { id: a.id } })),
    // ---- bring back what was removed ----
    ...accounts.deleted.map((a) => prisma.account.create({ data: revive(a) as Prisma.AccountUncheckedCreateInput })),
    ...parentsFirst(sections.deleted).map((s) => prisma.section.create({ data: revive(s) as Prisma.SectionUncheckedCreateInput })),
    ...goals.deleted.map((g) => prisma.goal.create({ data: revive(g) as Prisma.GoalUncheckedCreateInput })),
    ...listings.deleted.map((l) => prisma.listing.create({ data: revive(l) as Prisma.ListingUncheckedCreateInput })),
    ...incomes.deleted.map((i) => prisma.income.create({ data: revive(i) as Prisma.IncomeUncheckedCreateInput })),
    // ---- set back what was changed ----
    ...demoting.map((s) => prisma.section.update({ where: { id: s.id }, data: withoutId(s) as Prisma.SectionUncheckedUpdateInput })),
    ...otherSectionChanges.map((s) => prisma.section.update({ where: { id: s.id }, data: withoutId(s) as Prisma.SectionUncheckedUpdateInput })),
    ...accounts.changed.map((a) =>
      // Names and types only: balances move with money, which this never touches.
      prisma.account.update({ where: { id: a.id }, data: { name: a.name as string, type: a.type as 'SAVINGS' | 'SPENDING', identifiers: a.identifiers as string[] } }),
    ),
    ...goals.changed.map((g) => prisma.goal.update({ where: { id: g.id }, data: withoutId(g) as Prisma.GoalUncheckedUpdateInput })),
    ...listings.changed.map((l) => prisma.listing.update({ where: { id: l.id }, data: withoutId(l) as Prisma.ListingUncheckedUpdateInput })),
    ...incomes.changed.map((i) => prisma.income.update({ where: { id: i.id }, data: withoutId(i) as Prisma.IncomeUncheckedUpdateInput })),
    ...(before.plan && now.plan && before.plan.name !== now.plan.name
      ? [prisma.plan.update({ where: { id: before.plan.id }, data: { name: before.plan.name as string } })]
      : []),
  ];

  if (ops.length === 0) return;
  try {
    await prisma.$transaction(ops);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'P2003') {
      throw new ConflictException(
        'Cannot put the plan back: a section or account that was added has had transactions or other records attached since. Remove or move those first.',
      );
    }
    throw error;
  }
}
