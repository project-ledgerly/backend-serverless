import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { UpdateTransactionDto } from './dto/update-transaction.dto.js';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertAccountOwnedByUser(accountId: string, userId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) {
      throw new BadRequestException(`accountId ${accountId} is not an account of user ${userId}`);
    }
  }

  private async loadSectionAndCheckProtection(sectionId: string, confirmed: boolean | undefined) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { goal: true } });
    if (!section) {
      throw new BadRequestException(`sectionId ${sectionId} does not exist`);
    }
    if (section.protected && !confirmed) {
      throw new BadRequestException({
        issues: [
          {
            rule: 4,
            message: `Section "${section.name}" is protected — spending from it requires explicit confirmation (confirmed: true)`,
          },
        ],
      });
    }
    return section;
  }

  /**
   * A Transaction tagged to a section that has a linked Goal is a
   * contribution (positive) or a withdrawal (negative) against that Goal,
   * same signed-amount convention as Account.balance — a savings
   * withdrawal deducts from what was already committed, per spec.
   */
  private goalDeltaOp(goalId: string | undefined, amount: Prisma.Decimal.Value) {
    if (!goalId) return [];
    return [this.prisma.goal.update({ where: { id: goalId }, data: { currentAmount: { increment: amount } } })];
  }

  async create(dto: CreateTransactionDto) {
    await this.assertAccountOwnedByUser(dto.accountId, dto.userId);
    const section = await this.loadSectionAndCheckProtection(dto.sectionId, dto.confirmed);

    // amount is signed (see schema.prisma) — it's the source of truth the
    // account's balance (and the section's Goal, if any) are derived from.
    const [transaction] = await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          userId: dto.userId,
          accountId: dto.accountId,
          sectionId: dto.sectionId,
          amount: dto.amount,
          description: dto.description,
          date: new Date(dto.date),
          source: dto.source,
        },
      }),
      this.prisma.account.update({
        where: { id: dto.accountId },
        data: { balance: { increment: dto.amount } },
      }),
      ...this.goalDeltaOp(section.goal?.id, dto.amount),
    ]);
    return transaction;
  }

  findAllForAccount(accountId: string) {
    return this.prisma.transaction.findMany({ where: { accountId }, orderBy: { date: 'desc' } });
  }

  findAllForSection(sectionId: string) {
    return this.prisma.transaction.findMany({ where: { sectionId }, orderBy: { date: 'desc' } });
  }

  findAllForUser(userId: string) {
    return this.prisma.transaction.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 50 });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException(`Transaction ${id} not found`);
    return transaction;
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const transaction = await this.findOne(id);
    const oldSection = await this.prisma.section.findUnique({ where: { id: transaction.sectionId }, include: { goal: true } });

    if (dto.accountId !== undefined) {
      await this.assertAccountOwnedByUser(dto.accountId, transaction.userId);
    }
    const targetSectionId = dto.sectionId ?? transaction.sectionId;
    let newSection = oldSection;
    if (dto.sectionId !== undefined || dto.confirmed !== undefined) {
      newSection = await this.loadSectionAndCheckProtection(targetSectionId, dto.confirmed);
    }

    const definedUpdates = Object.fromEntries(
      Object.entries(dto).filter(([key, v]) => v !== undefined && key !== 'confirmed'),
    );
    if ('date' in definedUpdates) {
      definedUpdates.date = new Date(definedUpdates.date as string);
    }

    // Reverse the old amount off the old account (and old Goal, if any), then
    // apply the new amount to the (possibly different) new account/Goal —
    // simpler and just as correct as netting a delta, even when nothing changed.
    const newAccountId = dto.accountId ?? transaction.accountId;
    const newAmount = dto.amount ?? transaction.amount.toString();

    const ops = [
      this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { decrement: transaction.amount } },
      }),
      this.prisma.account.update({
        where: { id: newAccountId },
        data: { balance: { increment: newAmount } },
      }),
      ...this.goalDeltaOp(oldSection?.goal?.id, transaction.amount.negated()),
      ...this.goalDeltaOp(newSection?.goal?.id, newAmount),
      this.prisma.transaction.update({ where: { id }, data: definedUpdates }),
    ];
    const results = await this.prisma.$transaction(ops);
    return results[results.length - 1];
  }

  async remove(id: string) {
    const transaction = await this.findOne(id);
    const section = await this.prisma.section.findUnique({ where: { id: transaction.sectionId }, include: { goal: true } });
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { decrement: transaction.amount } },
      }),
      ...this.goalDeltaOp(section?.goal?.id, transaction.amount.negated()),
      this.prisma.transaction.delete({ where: { id } }),
    ]);
  }
}
