import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

// Never ship the password hash to a client.
const publicUser = {
  id: true,
  name: true,
  email: true,
  currency: true,
  settings: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: { name: dto.name, currency: dto.currency }, select: publicUser });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicUser });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency.trim().toUpperCase() } : {}),
        },
        select: publicUser,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Wipes everything the user has built (accounts, plan, sections, listings,
   * goals, incomes, transactions, transfers, rules, snapshots) and gives
   * them back a fresh default Plan and Main Account, like right after
   * registering. The login itself (name, email, password, currency) stays.
   * One DB transaction: it all goes or none of it does.
   */
  async reset(id: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const ownSections = { section: { plan: { userId: id } } };
      await tx.goalMonthSnapshot.deleteMany({ where: { goal: ownSections } });
      await tx.goal.deleteMany({ where: ownSections });
      await tx.sectionAllocation.deleteMany({ where: ownSections });
      await tx.rule.deleteMany({ where: { userId: id } });
      await tx.transaction.deleteMany({ where: { userId: id } });
      await tx.transfer.deleteMany({ where: { userId: id } });
      await tx.incomeReceipt.deleteMany({ where: { income: { userId: id } } });
      await tx.income.deleteMany({ where: { userId: id } });
      await tx.listing.deleteMany({ where: { userId: id } });
      await tx.netWorthSnapshot.deleteMany({ where: { userId: id } });
      await tx.section.updateMany({ where: { plan: { userId: id } }, data: { parentId: null } });
      await tx.section.deleteMany({ where: { plan: { userId: id } } });
      await tx.plan.deleteMany({ where: { userId: id } });
      await tx.account.deleteMany({ where: { userId: id } });
      const plan = await tx.plan.create({ data: { userId: id, name: 'My Plan', status: 'ACTIVE' } });
      const account = await tx.account.create({ data: { userId: id, name: 'Main Account', type: 'SPENDING', balance: 0 } });
      return { planId: plan.id, accountId: account.id };
    });
  }
}
