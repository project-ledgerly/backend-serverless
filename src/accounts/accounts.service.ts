import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
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
    const [transactions, receipts, sent, received] = await Promise.all([
      this.prisma.transaction.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
      this.prisma.incomeReceipt.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _sum: { amount: true } }),
      this.prisma.transfer.groupBy({ by: ['fromAccountId'], where: { fromAccountId: { in: accountIds } }, _sum: { amount: true } }),
      this.prisma.transfer.groupBy({ by: ['toAccountId'], where: { toAccountId: { in: accountIds } }, _sum: { amount: true } }),
    ]);
    const net = new Map<string, Decimal>(accountIds.map((id) => [id, new Decimal(0)]));
    const add = (id: string, amount: Prisma.Decimal | null, sign: 1 | -1) =>
      net.set(id, net.get(id)!.plus(new Decimal(amount?.toString() ?? '0').times(sign)));
    for (const row of [...transactions, ...receipts]) add(row.accountId, row._sum.amount, 1);
    for (const row of sent) add(row.fromAccountId, row._sum.amount, -1);
    for (const row of received) add(row.toAccountId, row._sum.amount, 1);
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

  /**
   * Sets the balance to 0 and keeps the history: the derived starting
   * balance absorbs the difference, so every transaction, receipt and
   * transfer is still listed.
   */
  async reset(id: string) {
    await this.findOne(id);
    await this.prisma.account.update({ where: { id }, data: { balance: '0' } });
    return this.findOne(id);
  }

  /** Moves money between two of the user's own accounts, atomically. */
  async transfer(dto: CreateTransferDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Pick two different accounts to move money between');
    }
    const amount = new Decimal(dto.amount);
    if (!amount.gt(0)) throw new BadRequestException('amount must be greater than 0');
    const accounts = await this.prisma.account.findMany({ where: { id: { in: [dto.fromAccountId, dto.toAccountId] } } });
    if (accounts.length !== 2 || accounts.some((a) => a.userId !== dto.userId)) {
      throw new BadRequestException('Both accounts must belong to the user');
    }
    const [transfer] = await this.prisma.$transaction([
      this.prisma.transfer.create({
        data: {
          userId: dto.userId,
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          amount: amount.toFixed(2),
          note: dto.note,
          date: new Date(dto.date),
        },
      }),
      this.prisma.account.update({ where: { id: dto.fromAccountId }, data: { balance: { decrement: amount.toFixed(2) } } }),
      this.prisma.account.update({ where: { id: dto.toAccountId }, data: { balance: { increment: amount.toFixed(2) } } }),
    ]);
    return transfer;
  }

  findTransfers(userId: string) {
    return this.prisma.transfer.findMany({ where: { userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
  }

  /** Undoes a transfer: puts the money back and deletes the record. */
  async removeTransfer(id: string) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found`);
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: transfer.fromAccountId }, data: { balance: { increment: transfer.amount } } }),
      this.prisma.account.update({ where: { id: transfer.toAccountId }, data: { balance: { decrement: transfer.amount } } }),
      this.prisma.transfer.delete({ where: { id } }),
    ]);
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
