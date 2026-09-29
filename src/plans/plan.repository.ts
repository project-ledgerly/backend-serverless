import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AllocationResult, SectionInput } from '../engine/types.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPlanSections(planId: string): Promise<SectionInput[]> {
    const sections = await this.prisma.section.findMany({ where: { planId } });
    return sections.map((s) => ({
      id: s.id,
      parentId: s.parentId,
      name: s.name,
      type: s.type as SectionInput['type'],
      allocationMode: s.allocationMode as SectionInput['allocationMode'],
      percentage: s.percentage.toString(),
      priorityOrder: s.priorityOrder,
      protected: s.protected,
    }));
  }

  async persistAllocation(incomeId: string, result: AllocationResult): Promise<void> {
    await this.prisma.sectionAllocation.createMany({
      data: Array.from(result.amounts.entries()).map(([sectionId, amount]) => ({
        sectionId,
        incomeId,
        amount: amount.toString(),
      })),
    });
  }

  /** sectionId -> accountId, for the sections in this plan that link to one. */
  async loadSectionAccountMap(planId: string): Promise<Map<string, string>> {
    const sections = await this.prisma.section.findMany({
      where: { planId, accountId: { not: null } },
      select: { id: true, accountId: true },
    });
    return new Map(sections.map((s) => [s.id, s.accountId as string]));
  }

  async getIncomeUserAndAccount(incomeId: string): Promise<{ userId: string; accountId: string }> {
    const income = await this.prisma.income.findUniqueOrThrow({ where: { id: incomeId } });
    return { userId: income.userId, accountId: income.accountId };
  }

  /**
   * The "transfer out" half of a payday allocation transfer — moves cash off
   * the income account only. Deliberately bypasses TransactionsService: it
   * has to be tagged with the *destination* section (Transaction.sectionId
   * is required, and there's no better answer), but that section's Goal
   * must NOT see this leg — it never lost anything, its account is the one
   * about to gain the matching credit. Only touches Account.balance.
   */
  async recordTransferOutLeg(userId: string, accountId: string, sectionId: string, amount: string, description: string) {
    await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: { userId, accountId, sectionId, amount, description, date: new Date(), source: 'allocation' },
      }),
      this.prisma.account.update({ where: { id: accountId }, data: { balance: { increment: amount } } }),
    ]);
  }
}
