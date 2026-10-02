import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Batch, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import type {
  DeleteRecordsDto,
  ListTransactionsQuery,
  ListTransfersQuery,
  ReconcileDto,
  UpdateTransactionsDto,
} from './dto/records.dto.js';
import { Effects, fromCents, toCents, type GoalRef } from './effects.js';

const num = (d: { toString(): string }) => Number(d.toString());
const MIN_YEAR = 2000;
const MAX_FUTURE_DAYS = 31;

/** A row as stored in a batch's undo data: dates and decimals become strings. */
const freeze = <T>(row: T): Prisma.InputJsonValue => JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;

interface FrozenTransaction {
  id: string;
  userId: string;
  accountId: string;
  sectionId: string;
  listingId: string | null;
  amount: string;
  description: string;
  date: string;
  source: string;
  merchant: string | null;
  raw: string | null;
}

interface FrozenTransfer {
  id: string;
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  note: string | null;
  goalSectionId: string | null;
  date: string;
  createdAt: string;
}

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- reading ----------

  async listTransactions(auth: AuthContext, q: ListTransactionsQuery) {
    const where: Prisma.TransactionWhereInput = { userId: auth.userId };
    if (auth.accountIds.length > 0) where.accountId = { in: [...auth.accountIds] };
    if (q.accountId) where.accountId = q.accountId;
    if (q.sectionId) where.sectionId = q.sectionId;
    if (q.from || q.to) {
      where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    }
    if (q.q) {
      where.OR = [
        { description: { contains: q.q, mode: 'insensitive' } },
        { merchant: { contains: q.q, mode: 'insensitive' } },
        { raw: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        take: q.limit ?? 50,
        skip: q.offset ?? 0,
        include: {
          account: { select: { name: true } },
          section: { select: { name: true } },
          listing: { select: { name: true } },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((t) => ({
        id: t.id,
        date: t.date.toISOString().slice(0, 10),
        amount: num(t.amount),
        description: t.description,
        merchant: t.merchant,
        raw: t.raw,
        accountId: t.accountId,
        account: t.account.name,
        sectionId: t.sectionId,
        section: t.section.name,
        listingId: t.listingId,
        bill: t.listing?.name ?? null,
        source: t.source,
        batchId: t.batchId,
      })),
    };
  }

  async listTransfers(auth: AuthContext, q: ListTransfersQuery) {
    const where: Prisma.TransferWhereInput = { userId: auth.userId };
    if (auth.accountIds.length > 0) {
      where.AND = [{ fromAccountId: { in: [...auth.accountIds] } }, { toAccountId: { in: [...auth.accountIds] } }];
    }
    if (q.from || q.to) {
      where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    }
    const rows = await this.prisma.transfer.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: q.limit ?? 50,
      include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      amount: num(t.amount),
      from: t.fromAccount.name,
      to: t.toAccount.name,
      note: t.note,
      goalSectionId: t.goalSectionId,
      batchId: t.batchId,
    }));
  }

  // ---------- deleting ----------

  async deleteTransactions(auth: AuthContext, dto: DeleteRecordsDto) {
    const ids = [...new Set(dto.ids)];
    const rows = await this.prisma.transaction.findMany({ where: { id: { in: ids }, userId: auth.userId } });
    this.assertAllFound(ids, rows.map((r) => r.id), 'transactions');
    for (const r of rows) this.assertAccountAllowed(auth, r.accountId);

    const goals = await this.goalsBySection(rows.map((r) => r.sectionId));
    const effects = new Effects();
    for (const r of rows) effects.transaction({ accountId: r.accountId, cents: toCents(num(r.amount)), goal: goals.get(r.sectionId) ?? null }, -1);

    const result = {
      dryRun: Boolean(dto.dryRun),
      batchId: null as string | null,
      deleted: rows.length,
      removed: rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), amount: num(r.amount), description: r.description })),
      balanceChanges: effects.accountChanges(await this.accountNames(auth.userId)),
    };
    if (dto.dryRun) return result;

    const batchId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.batch.create({
        data: {
          id: batchId,
          userId: auth.userId,
          tokenId: auth.tokenId,
          kind: 'delete',
          summary: dto.summary ?? `Deleted ${rows.length} transaction${rows.length === 1 ? '' : 's'}`,
          undoData: { transactions: rows.map(freeze) } as Prisma.InputJsonValue,
        },
      }),
      ...effects.ops(this.prisma),
      this.prisma.transaction.deleteMany({ where: { id: { in: ids } } }),
    ]);
    return { ...result, batchId };
  }

  async deleteTransfers(auth: AuthContext, dto: DeleteRecordsDto) {
    const ids = [...new Set(dto.ids)];
    const rows = await this.prisma.transfer.findMany({ where: { id: { in: ids }, userId: auth.userId } });
    this.assertAllFound(ids, rows.map((r) => r.id), 'transfers');
    for (const r of rows) {
      this.assertAccountAllowed(auth, r.fromAccountId);
      this.assertAccountAllowed(auth, r.toAccountId);
    }

    const goalIds = await this.goalIdsBySection(rows.map((r) => r.goalSectionId).filter((x): x is string => !!x));
    const effects = new Effects();
    for (const r of rows) {
      effects.transfer(
        { fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, cents: toCents(num(r.amount)), goalId: r.goalSectionId ? (goalIds.get(r.goalSectionId) ?? null) : null },
        -1,
      );
    }

    const result = {
      dryRun: Boolean(dto.dryRun),
      batchId: null as string | null,
      deleted: rows.length,
      balanceChanges: effects.accountChanges(await this.accountNames(auth.userId)),
    };
    if (dto.dryRun) return result;

    const batchId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.batch.create({
        data: {
          id: batchId,
          userId: auth.userId,
          tokenId: auth.tokenId,
          kind: 'delete',
          summary: dto.summary ?? `Deleted ${rows.length} transfer${rows.length === 1 ? '' : 's'}`,
          undoData: { transfers: rows.map(freeze) } as Prisma.InputJsonValue,
        },
      }),
      ...effects.ops(this.prisma),
      this.prisma.transfer.deleteMany({ where: { id: { in: ids } } }),
    ]);
    return { ...result, batchId };
  }

  // ---------- editing ----------

  async updateTransactions(auth: AuthContext, dto: UpdateTransactionsDto) {
    const ids = dto.changes.map((c) => c.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each transaction can appear only once in changes');
    const before = await this.prisma.transaction.findMany({ where: { id: { in: ids }, userId: auth.userId } });
    this.assertAllFound(ids, before.map((r) => r.id), 'transactions');
    const byId = new Map(before.map((r) => [r.id, r]));

    const [accounts, sections, listings] = await Promise.all([
      this.prisma.account.findMany({ where: { userId: auth.userId }, select: { id: true, name: true } }),
      this.prisma.section.findMany({ where: { plan: { userId: auth.userId } }, select: { id: true, name: true, goal: { select: { id: true, mode: true } } } }),
      this.prisma.listing.findMany({ where: { userId: auth.userId }, select: { id: true, name: true, sectionId: true } }),
    ]);
    const accountIds = new Set(accounts.map((a) => a.id));
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const listingById = new Map(listings.map((l) => [l.id, l]));
    const latest = Date.now() + MAX_FUTURE_DAYS * 86_400_000;

    const errors: string[] = [];
    const effects = new Effects();
    const updates: Prisma.PrismaPromise<unknown>[] = [];

    dto.changes.forEach((c, i) => {
      const old = byId.get(c.id)!;
      const fail = (m: string) => errors.push(`changes[${i}]: ${m}`);
      this.assertAccountAllowed(auth, old.accountId);

      const accountId = c.accountId ?? old.accountId;
      const sectionId = c.sectionId ?? old.sectionId;
      if (!accountIds.has(accountId)) return fail('accountId is not one of your accounts');
      this.assertAccountAllowed(auth, accountId);
      const section = sectionById.get(sectionId);
      if (!section) return fail('sectionId is not one of your sections');

      let listingId: string | null = old.listingId;
      if (c.listingId === null) listingId = null;
      else if (c.listingId !== undefined) listingId = c.listingId;
      else if (c.sectionId && c.sectionId !== old.sectionId && listingId && listingById.get(listingId)?.sectionId !== sectionId) listingId = null;
      if (listingId) {
        const listing = listingById.get(listingId);
        if (!listing) return fail('listingId is not one of your bills');
        if (listing.sectionId !== sectionId) return fail(`"${listing.name}" belongs to a different section`);
      }

      let date = old.date;
      if (c.date) {
        date = new Date(c.date);
        if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < MIN_YEAR || date.getTime() > latest) return fail(`date ${c.date} is not a sensible date`);
      }
      const cents = c.amount === undefined ? toCents(num(old.amount)) : toCents(c.amount);
      if (cents === 0) return fail('amount cannot be 0');
      const description = c.description?.trim() ?? old.description;
      if (!description) return fail('description cannot be empty');

      const oldGoal = sectionById.get(old.sectionId)?.goal ?? null;
      effects.transaction({ accountId: old.accountId, cents: toCents(num(old.amount)), goal: oldGoal }, -1);
      effects.transaction({ accountId, cents, goal: section.goal }, 1);

      updates.push(
        this.prisma.transaction.update({
          where: { id: old.id },
          data: {
            accountId,
            sectionId,
            listingId,
            description,
            merchant: c.merchant ?? old.merchant,
            date,
            amount: fromCents(cents),
          },
        }),
      );
    });

    if (errors.length > 0) throw new BadRequestException(`Nothing was changed. ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors.slice(0, 20).join('; ')}`);

    const result = {
      dryRun: Boolean(dto.dryRun),
      batchId: null as string | null,
      updated: dto.changes.length,
      balanceChanges: effects.accountChanges(new Map(accounts.map((a) => [a.id, a.name]))),
    };
    if (dto.dryRun) return result;

    const batchId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.batch.create({
        data: {
          id: batchId,
          userId: auth.userId,
          tokenId: auth.tokenId,
          kind: 'update',
          summary: dto.summary ?? `Edited ${dto.changes.length} transaction${dto.changes.length === 1 ? '' : 's'}`,
          undoData: { transactions: before.map(freeze) } as Prisma.InputJsonValue,
        },
      }),
      ...updates,
      ...effects.ops(this.prisma),
    ]);
    return { ...result, batchId };
  }

  // ---------- reconciling ----------

  /** Sets an account's balance to what the bank says; the transactions stay as they are. */
  async reconcile(auth: AuthContext, accountId: string, dto: ReconcileDto) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId: auth.userId } });
    if (!account) throw new NotFoundException('Account not found');
    const before = toCents(num(account.balance));
    const target = toCents(dto.balance);
    const delta = target - before;
    const result = {
      dryRun: Boolean(dto.dryRun),
      batchId: null as string | null,
      account: account.name,
      balanceBefore: before / 100,
      balanceAfter: target / 100,
      change: delta / 100,
    };
    if (dto.dryRun || delta === 0) return result;

    const batchId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.batch.create({
        data: {
          id: batchId,
          userId: auth.userId,
          tokenId: auth.tokenId,
          kind: 'reconcile',
          summary: dto.summary ?? `Set ${account.name} to ${target / 100}`,
          undoData: { accountId, deltaCents: delta },
        },
      }),
      this.prisma.account.update({ where: { id: accountId }, data: { balance: { increment: fromCents(delta) } } }),
    ]);
    return { ...result, batchId };
  }

  // ---------- undoing ----------

  /** Reverses a batch that was not an import (those are handled by BatchService). */
  async undo(batch: Batch) {
    const data = (batch.undoData ?? {}) as {
      transactions?: FrozenTransaction[];
      transfers?: FrozenTransfer[];
      accountId?: string;
      deltaCents?: number;
    };
    const done = (extra: Record<string, unknown>) => ({ batchId: batch.id, alreadyUndone: false, kind: batch.kind, ...extra });

    if (batch.kind === 'reconcile') {
      await this.prisma.$transaction([
        this.prisma.account.update({ where: { id: data.accountId! }, data: { balance: { decrement: fromCents(data.deltaCents ?? 0) } } }),
        this.prisma.batch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } }),
      ]);
      return done({ restored: { accountBalanceChange: -(data.deltaCents ?? 0) / 100 } });
    }

    const frozenTx = data.transactions ?? [];
    const frozenTr = data.transfers ?? [];
    const goals = await this.goalsBySection(frozenTx.map((t) => t.sectionId));
    const goalIds = await this.goalIdsBySection(frozenTr.map((t) => t.goalSectionId).filter((x): x is string => !!x));
    const effects = new Effects();

    if (batch.kind === 'delete') {
      const ok = await this.referencesStillExist(batch.userId, frozenTx, frozenTr);
      if (ok) throw new ConflictException(ok);
      // A bill deleted since is simply no longer linked.
      const billIds = [...new Set(frozenTx.map((t) => t.listingId).filter((x): x is string => !!x))];
      const bills = new Set(
        (await this.prisma.listing.findMany({ where: { id: { in: billIds }, userId: batch.userId }, select: { id: true } })).map((l) => l.id),
      );
      for (const t of frozenTx) effects.transaction({ accountId: t.accountId, cents: toCents(Number(t.amount)), goal: goals.get(t.sectionId) ?? null }, 1);
      for (const t of frozenTr) {
        effects.transfer({ fromAccountId: t.fromAccountId, toAccountId: t.toAccountId, cents: toCents(Number(t.amount)), goalId: t.goalSectionId ? (goalIds.get(t.goalSectionId) ?? null) : null }, 1);
      }
      await this.prisma.$transaction([
        ...(frozenTx.length
          ? [
              this.prisma.transaction.createMany({
                data: frozenTx.map((t) => ({ ...t, listingId: t.listingId && bills.has(t.listingId) ? t.listingId : null, date: new Date(t.date), batchId: null })),
              }),
            ]
          : []),
        ...(frozenTr.length
          ? [this.prisma.transfer.createMany({ data: frozenTr.map((t) => ({ ...t, date: new Date(t.date), createdAt: new Date(t.createdAt), batchId: null })) })]
          : []),
        ...effects.ops(this.prisma),
        this.prisma.batch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } }),
      ]);
      return done({ restored: { transactions: frozenTx.length, transfers: frozenTr.length } });
    }

    if (batch.kind === 'update') {
      const current = await this.prisma.transaction.findMany({ where: { id: { in: frozenTx.map((t) => t.id) } } });
      const currentGoals = await this.goalsBySection(current.map((t) => t.sectionId));
      const now = new Map(current.map((t) => [t.id, t]));
      const restores: Prisma.PrismaPromise<unknown>[] = [];
      for (const t of frozenTx) {
        const cur = now.get(t.id);
        if (!cur) continue; // deleted since; deleting it already reversed its effect
        effects.transaction({ accountId: cur.accountId, cents: toCents(num(cur.amount)), goal: currentGoals.get(cur.sectionId) ?? null }, -1);
        effects.transaction({ accountId: t.accountId, cents: toCents(Number(t.amount)), goal: goals.get(t.sectionId) ?? null }, 1);
        restores.push(
          this.prisma.transaction.update({
            where: { id: t.id },
            data: {
              accountId: t.accountId,
              sectionId: t.sectionId,
              listingId: t.listingId,
              amount: t.amount,
              description: t.description,
              merchant: t.merchant,
              date: new Date(t.date),
            },
          }),
        );
      }
      await this.prisma.$transaction([
        ...restores,
        ...effects.ops(this.prisma),
        this.prisma.batch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } }),
      ]);
      return done({ restored: { transactions: restores.length } });
    }

    throw new BadRequestException(`Cannot undo a batch of kind "${batch.kind}"`);
  }

  // ---------- helpers ----------

  private assertAllFound(wanted: string[], found: string[], what: string) {
    const have = new Set(found);
    const missing = wanted.filter((id) => !have.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Nothing was changed. These ${what} were not found: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`);
    }
  }

  private assertAccountAllowed(auth: AuthContext, accountId: string) {
    if (auth.accountIds.length > 0 && !auth.accountIds.includes(accountId)) {
      throw new ForbiddenException('This token is not allowed to use that account');
    }
  }

  private async accountNames(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId }, select: { id: true, name: true } });
    return new Map(accounts.map((a) => [a.id, a.name]));
  }

  private async goalsBySection(sectionIds: string[]): Promise<Map<string, GoalRef>> {
    if (sectionIds.length === 0) return new Map();
    const goals = await this.prisma.goal.findMany({ where: { sectionId: { in: [...new Set(sectionIds)] } }, select: { id: true, mode: true, sectionId: true } });
    return new Map(goals.map((g) => [g.sectionId, { id: g.id, mode: g.mode }]));
  }

  /** Transfers pay into a goal that is not a reserve; map section id to goal id. */
  private async goalIdsBySection(sectionIds: string[]): Promise<Map<string, string>> {
    const goals = await this.goalsBySection(sectionIds);
    return new Map([...goals.entries()].filter(([, g]) => g.mode !== 'RESERVE').map(([sectionId, g]) => [sectionId, g.id]));
  }

  /** Why a deleted record can no longer be brought back, or null when it can. */
  private async referencesStillExist(userId: string, tx: FrozenTransaction[], tr: FrozenTransfer[]): Promise<string | null> {
    const accountIds = [...new Set([...tx.map((t) => t.accountId), ...tr.flatMap((t) => [t.fromAccountId, t.toAccountId])])];
    const sectionIds = [...new Set(tx.map((t) => t.sectionId))];
    const [accounts, sections] = await Promise.all([
      this.prisma.account.count({ where: { id: { in: accountIds }, userId } }),
      this.prisma.section.count({ where: { id: { in: sectionIds }, plan: { userId } } }),
    ]);
    if (accounts !== accountIds.length) return 'Cannot undo: an account these records belonged to has been deleted since.';
    if (sections !== sectionIds.length) return 'Cannot undo: a plan section these records belonged to has been deleted since.';
    return null;
  }
}
