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
}
