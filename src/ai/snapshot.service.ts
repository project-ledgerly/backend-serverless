import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SectionsService } from '../sections/sections.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { buildSnapshot, type Snapshot } from './snapshot.builder.js';

const RECENT_COUNT = 15;
const MONTH_LIMIT = 5000;

const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

@Injectable()
export class SnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sections: SectionsService,
  ) {}

  async forUser(auth: AuthContext): Promise<Snapshot> {
    const userId = auth.userId;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [user, accounts, incomes, plan, listings, goals, monthTransactions, recentTransactions] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, currency: true } }),
      this.prisma.account.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      this.prisma.income.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
      this.prisma.plan.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.listing.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.goal.findMany({ where: { section: { plan: { userId } } } }),
      this.prisma.transaction.findMany({
        where: { userId, date: { gte: monthStart } },
        orderBy: { date: 'desc' },
        take: MONTH_LIMIT,
      }),
      this.prisma.transaction.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: RECENT_COUNT }),
    ]);

    const sections = plan ? await this.sections.findAllForPlan(plan.id) : [];

    const tx = (t: (typeof monthTransactions)[number]) => ({
      id: t.id,
      date: t.date,
      amount: num(t.amount),
      description: t.description,
      accountId: t.accountId,
      sectionId: t.sectionId,
      listingId: t.listingId,
    });

    return buildSnapshot({
      now,
      user,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: num(a.balance) })),
      incomes: incomes.map((i) => ({
        id: i.id,
        source: i.source,
        amount: num(i.amount),
        recurring: i.recurring,
        frequency: i.frequency,
        nextRunDate: i.nextRunDate,
        accountId: i.accountId,
      })),
      plan: plan ? { id: plan.id, name: plan.name } : null,
      sections: sections.map((s) => ({
        id: s.id,
        parentId: s.parentId,
        name: s.name,
        type: s.type,
        allocationMode: s.allocationMode,
        percentage: num(s.percentage),
        accountId: s.accountId,
        protected: s.protected,
        projectedAmount: num(s.projectedAmount),
      })),
      listings: listings.map((l) => ({
        id: l.id,
        sectionId: l.sectionId,
        name: l.name,
        amount: num(l.amount),
        dueDay: l.dueDay,
      })),
      goals: goals.map((g) => ({
        id: g.id,
        sectionId: g.sectionId,
        mode: g.mode,
        targetAmount: num(g.targetAmount),
        currentAmount: num(g.currentAmount),
        startingAmount: num(g.startingAmount),
        targetDate: g.targetDate,
      })),
      monthTransactions: monthTransactions.map(tx),
      recentTransactions: recentTransactions.map(tx),
      allowedAccountIds: auth.accountIds,
    });
  }
}
