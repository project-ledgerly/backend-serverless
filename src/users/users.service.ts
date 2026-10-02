import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
    // The array form of $transaction sends the statements as one batch. The
    // interactive callback form has a 5s default timeout, which a remote
    // database over a serverless link blows through with this many deletes.
    const ownSections = { section: { plan: { userId: id } } };
    const planId = randomUUID();
    const accountId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.goalMonthSnapshot.deleteMany({ where: { goal: ownSections } }),
      this.prisma.goal.deleteMany({ where: ownSections }),
      this.prisma.sectionAllocation.deleteMany({ where: ownSections }),
      this.prisma.rule.deleteMany({ where: { userId: id } }),
      this.prisma.transaction.deleteMany({ where: { userId: id } }),
      this.prisma.transfer.deleteMany({ where: { userId: id } }),
      this.prisma.incomeReceipt.deleteMany({ where: { income: { userId: id } } }),
      this.prisma.income.deleteMany({ where: { userId: id } }),
      this.prisma.listing.deleteMany({ where: { userId: id } }),
      this.prisma.netWorthSnapshot.deleteMany({ where: { userId: id } }),
      this.prisma.section.updateMany({ where: { plan: { userId: id } }, data: { parentId: null } }),
      this.prisma.section.deleteMany({ where: { plan: { userId: id } } }),
      this.prisma.plan.deleteMany({ where: { userId: id } }),
      this.prisma.account.deleteMany({ where: { userId: id } }),
      this.prisma.plan.create({ data: { id: planId, userId: id, name: 'My Plan', status: 'ACTIVE' } }),
      this.prisma.account.create({ data: { id: accountId, userId: id, name: 'Main Account', type: 'SPENDING', balance: 0 } }),
    ]);
    return { planId, accountId };
  }
}
