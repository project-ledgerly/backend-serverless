import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';
import type { UpdateAccountDto } from './dto/update-account.dto.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        userId: dto.userId,
        name: dto.name,
        type: dto.type,
        balance: dto.balance ?? '0',
      },
    });
  }

  /**
   * Net money that has moved through each account since it was opened:
   * every Transaction (signed) plus every income receipt. balance minus this
   * is the account's starting balance.
   */
  private async netMovement(accountIds: string[]): Promise<Map<string, Decimal>> {
    const [transactions, receipts] = await Promise.all([
      this.prisma.transaction.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
      this.prisma.incomeReceipt.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
    ]);
    const net = new Map<string, Decimal>(accountIds.map((id) => [id, new Decimal(0)]));
    for (const row of [...transactions, ...receipts]) {
      net.set(row.accountId, net.get(row.accountId)!.plus(row._sum.amount?.toString() ?? '0'));
    }
    return net;
  }

  private withStartingBalance<T extends { id: string; balance: Prisma.Decimal }>(accounts: T[], net: Map<string, Decimal>) {
    return accounts.map((a) => ({
      ...a,
      startingBalance: new Decimal(a.balance.toString()).minus(net.get(a.id) ?? 0).toFixed(2),
    }));
  }

  async findAllForUser(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return this.withStartingBalance(accounts, await this.netMovement(accounts.map((a) => a.id)));
  }

  async findOne(id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return (this.withStartingBalance([account], await this.netMovement([id])))[0];
  }

  async update(id: string, dto: UpdateAccountDto) {
    const account = await this.findOne(id);
    const data: Prisma.AccountUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startingBalance !== undefined) {
      // balance = startingBalance + net movement, so shift by the difference.
      const delta = new Decimal(dto.startingBalance).minus(account.startingBalance);
      data.balance = { increment: delta.toFixed(2) };
    }
    await this.prisma.account.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.account.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Account still has transactions or linked sections attached');
      }
      throw error;
    }
  }
}
