import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
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

  async create(dto: CreateTransactionDto) {
    await this.assertAccountOwnedByUser(dto.accountId, dto.userId);
    await this.loadSectionAndCheckProtection(dto.sectionId, dto.confirmed);

    // amount is signed (see schema.prisma) — it's the source of truth the
    // account's balance is derived from, not just a record alongside it.
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
    ]);
    return transaction;
  }

  findAllForAccount(accountId: string) {
    return this.prisma.transaction.findMany({ where: { accountId }, orderBy: { date: 'desc' } });
  }

  findAllForSection(sectionId: string) {
    return this.prisma.transaction.findMany({ where: { sectionId }, orderBy: { date: 'desc' } });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException(`Transaction ${id} not found`);
    return transaction;
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const transaction = await this.findOne(id);

    if (dto.accountId !== undefined) {
      await this.assertAccountOwnedByUser(dto.accountId, transaction.userId);
    }
    const targetSectionId = dto.sectionId ?? transaction.sectionId;
    if (dto.sectionId !== undefined || dto.confirmed !== undefined) {
      await this.loadSectionAndCheckProtection(targetSectionId, dto.confirmed);
    }

    const definedUpdates = Object.fromEntries(
      Object.entries(dto).filter(([key, v]) => v !== undefined && key !== 'confirmed'),
    );
    if ('date' in definedUpdates) {
      definedUpdates.date = new Date(definedUpdates.date as string);
    }

    // Reverse the old amount off the old account, then apply the new amount
    // to the (possibly different) new account — two ops even when the
    // account didn't change, simpler and just as correct as netting a delta.
    const newAccountId = dto.accountId ?? transaction.accountId;
    const newAmount = dto.amount ?? transaction.amount.toString();

    const [, , updated] = await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { decrement: transaction.amount } },
      }),
      this.prisma.account.update({
        where: { id: newAccountId },
        data: { balance: { increment: newAmount } },
      }),
      this.prisma.transaction.update({ where: { id }, data: definedUpdates }),
    ]);
    return updated;
  }

  async remove(id: string) {
    const transaction = await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: transaction.accountId },
        data: { balance: { decrement: transaction.amount } },
      }),
      this.prisma.transaction.delete({ where: { id } }),
    ]);
  }
}
