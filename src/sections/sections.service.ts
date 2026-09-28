import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Section } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { validatePlanStructure } from '../engine/validationService.js';
import type { SectionInput } from '../engine/types.js';
import type { CreateSectionDto } from './dto/create-section.dto.js';
import type { UpdateSectionDto } from './dto/update-section.dto.js';
import type { ReorderSectionsDto } from './dto/reorder-sections.dto.js';

function toSectionInput(s: Section): SectionInput {
  return {
    id: s.id,
    parentId: s.parentId,
    name: s.name,
    type: s.type as SectionInput['type'],
    allocationMode: s.allocationMode as SectionInput['allocationMode'],
    percentage: s.percentage.toString(),
    priorityOrder: s.priorityOrder,
    protected: s.protected,
  };
}

@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertParentInPlan(planId: string, parentId: string | null | undefined) {
    if (!parentId) return;
    const parent = await this.prisma.section.findUnique({ where: { id: parentId } });
    if (!parent || parent.planId !== planId) {
      throw new BadRequestException(`parentId ${parentId} is not a section of plan ${planId}`);
    }
  }

  private assertStructureValid(hypothetical: SectionInput[]) {
    const validation = validatePlanStructure(hypothetical);
    if (!validation.valid) {
      throw new BadRequestException({ issues: validation.issues });
    }
  }

  async create(planId: string, dto: CreateSectionDto) {
    await this.assertParentInPlan(planId, dto.parentId);

    const existing = await this.prisma.section.findMany({ where: { planId } });
    const hypothetical: SectionInput[] = [
      ...existing.map(toSectionInput),
      {
        id: 'pending',
        parentId: dto.parentId ?? null,
        name: dto.name,
        type: dto.type,
        allocationMode: dto.allocationMode,
        percentage: dto.percentage,
        priorityOrder: dto.priorityOrder,
        protected: dto.protected ?? false,
      },
    ];
    this.assertStructureValid(hypothetical);

    try {
      return await this.prisma.section.create({ data: { ...dto, planId } });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  findAllForPlan(planId: string) {
    return this.prisma.section.findMany({
      where: { planId },
      orderBy: { priorityOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const section = await this.prisma.section.findUnique({ where: { id } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);
    return section;
  }

  async update(id: string, dto: UpdateSectionDto) {
    const section = await this.findOne(id);
    if (dto.parentId !== undefined) {
      await this.assertParentInPlan(section.planId, dto.parentId);
    }

    const existing = await this.prisma.section.findMany({ where: { planId: section.planId } });
    // dto's declared-but-unset fields are own properties set to `undefined`
    // (TS class fields under ES2022), so a blind spread would clobber the
    // real existing values for every field the PATCH body didn't include —
    // only merge keys the caller actually sent.
    const definedUpdates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const merged: SectionInput = { ...toSectionInput(section), ...definedUpdates };
    const hypothetical = existing.map((s) => (s.id === id ? merged : toSectionInput(s)));
    this.assertStructureValid(hypothetical);

    try {
      return await this.prisma.section.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.section.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Section still has a goal, transactions, rules, or allocations attached');
      }
      throw error;
    }
  }

  /** Assigns priorityOrder 1..n to the given sections by array position. */
  async reorder(planId: string, dto: ReorderSectionsDto) {
    const sections = await this.prisma.section.findMany({
      where: { id: { in: dto.orderedSectionIds }, planId },
    });
    if (sections.length !== dto.orderedSectionIds.length) {
      throw new BadRequestException('orderedSectionIds must all belong to this plan');
    }
    const parentIds = new Set(sections.map((s) => s.parentId));
    if (parentIds.size > 1) {
      throw new BadRequestException('orderedSectionIds must all share the same parent');
    }

    await this.prisma.$transaction(
      dto.orderedSectionIds.map((id, index) =>
        this.prisma.section.update({ where: { id }, data: { priorityOrder: index + 1 } }),
      ),
    );
    return this.findAllForPlan(planId);
  }

  private translateWriteError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(
        'This sibling group already has a remainder-mode section — rule 3 allows exactly one',
      );
    }
    return error;
  }
}
