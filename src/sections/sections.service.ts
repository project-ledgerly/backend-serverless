import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Section } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { validateSiblingGroup } from '../engine/validationService.js';
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

  private assertSiblingGroupValid(siblings: SectionInput[]) {
    const validation = validateSiblingGroup(siblings);
    if (!validation.valid) {
      throw new BadRequestException({ issues: validation.issues });
    }
  }

  /**
   * A SAVINGS-type Section may only link to a SAVINGS-type Account;
   * everything else (Essential, Goal, Flexible) may only link to a
   * SPENDING-type Account. Money for a savings goal shouldn't be able to
   * point at the same pot as grocery spending.
   */
  private async assertAccountTypeMatches(sectionType: Section['type'], accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new BadRequestException(`accountId ${accountId} does not exist`);
    }
    const expected = sectionType === 'SAVINGS' ? 'SAVINGS' : 'SPENDING';
    if (account.type !== expected) {
      throw new BadRequestException(
        `A ${sectionType} section can only link to a ${expected} account, but ${accountId} is ${account.type}`,
      );
    }
  }

  async create(planId: string, dto: CreateSectionDto) {
    await this.assertParentInPlan(planId, dto.parentId);
    if (dto.accountId) {
      await this.assertAccountTypeMatches(dto.type, dto.accountId);
    }

    const parentId = dto.parentId ?? null;
    const siblings = await this.prisma.section.findMany({ where: { planId, parentId } });
    const pending: SectionInput = {
      id: 'pending',
      parentId,
      name: dto.name,
      type: dto.type,
      allocationMode: dto.allocationMode,
      percentage: dto.percentage,
      priorityOrder: dto.priorityOrder,
      protected: dto.protected ?? false,
    };
    this.assertSiblingGroupValid([...siblings.map(toSectionInput), pending]);

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

    const resolvedAccountId = dto.accountId !== undefined ? dto.accountId : section.accountId;
    if (resolvedAccountId) {
      await this.assertAccountTypeMatches(dto.type ?? section.type, resolvedAccountId);
    }

    // dto's declared-but-unset fields are own properties set to `undefined`
    // (TS class fields under ES2022), so a blind spread would clobber the
    // real existing values for every field the PATCH body didn't include —
    // only merge keys the caller actually sent.
    const definedUpdates = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const merged: SectionInput = { ...toSectionInput(section), ...definedUpdates };

    // Rule 6: only the edited section's (possibly new) sibling group needs
    // re-validating, not the whole plan — moving away from the old group
    // can only shrink its percentage sum, so it never needs rechecking.
    const newSiblings = await this.prisma.section.findMany({
      where: { planId: section.planId, parentId: merged.parentId, id: { not: id } },
    });
    this.assertSiblingGroupValid([...newSiblings.map(toSectionInput), merged]);

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
