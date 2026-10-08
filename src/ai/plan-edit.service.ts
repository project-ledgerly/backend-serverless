import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { Prisma, type Batch, type Section } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { IncomeService } from '../income/income.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { SectionsService } from '../sections/sections.service.js';
import { validatePlanStructure } from '../engine/validationService.js';
import type { SectionInput } from '../engine/types.js';
import type { AuthContext } from '../auth/auth-context.js';
import type { CreateGoalDto } from '../goals/dto/create-goal.dto.js';
import type { CreateIncomeDto } from '../income/dto/create-income.dto.js';
import type { EditPlanDto } from './dto/edit-plan.dto.js';
import { ACCOUNT_OPS, parseOps, type PlanOp } from './plan-ops.js';
import { capturePlan, restorePlan, type PlanSnapshot } from './plan-snapshot.js';

/** The readable text inside whatever a service threw. */
function messageOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return body;
    const b = body as { message?: string | string[]; issues?: Array<{ message: string }> };
    if (b.issues?.length) return b.issues.map((i) => i.message).join('; ');
    if (Array.isArray(b.message)) return b.message.join('; ');
    if (b.message) return b.message;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return 'that would give a sibling group two remainder sections; change the current remainder first';
  }
  return error instanceof Error ? error.message : String(error);
}

const toInput = (s: Section): SectionInput => ({
  id: s.id,
  parentId: s.parentId,
  name: s.name,
  type: s.type as SectionInput['type'],
  allocationMode: s.allocationMode as SectionInput['allocationMode'],
  percentage: s.percentage.toString(),
  priorityOrder: s.priorityOrder,
  protected: s.protected,
});

class OpFailed extends Error {
  constructor(
    readonly index: number,
    readonly op: string,
    message: string,
  ) {
    super(message);
  }
}

interface Run {
  auth: AuthContext;
  planId: string;
  refs: Map<string, string>;
}

@Injectable()
export class PlanEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sections: SectionsService,
    private readonly listings: ListingsService,
    private readonly goals: GoalsService,
    private readonly incomes: IncomeService,
    private readonly accounts: AccountsService,
  ) {}

  async edit(auth: AuthContext, dto: EditPlanDto) {
    const { ops, errors } = parseOps(dto.ops);
    if (errors.length > 0) {
      throw new BadRequestException(`Nothing was changed. ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors.slice(0, 20).join('; ')}`);
    }
    if (ops.some((o) => ACCOUNT_OPS.has(o.op))) {
      if (!auth.scopes.includes('accounts:write')) throw new ForbiddenException('This token is missing the accounts:write scope, which adding, renaming and removing accounts needs');
      if (auth.accountIds.length > 0) throw new ForbiddenException('A token limited to some accounts cannot add, rename or remove accounts');
    }

    const plan = await this.prisma.plan.findFirst({ where: { userId: auth.userId }, orderBy: { createdAt: 'asc' } });
    if (!plan) throw new BadRequestException('This user has no plan yet');

    const before = await capturePlan(this.prisma, auth.userId);
    const batchId = randomUUID();
    await this.prisma.batch.create({
      data: {
        id: batchId,
        userId: auth.userId,
        tokenId: auth.tokenId,
        kind: 'plan',
        summary: dto.summary ?? `Edited the plan (${ops.length} change${ops.length === 1 ? '' : 's'})`,
        undoData: before as unknown as Prisma.InputJsonValue,
      },
    });

    const run: Run = { auth, planId: plan.id, refs: new Map() };
    try {
      for (const [index, op] of ops.entries()) {
        try {
          await this.apply(run, op);
        } catch (e) {
          throw new OpFailed(index, op.op, messageOf(e));
        }
      }
      const all = await this.prisma.section.findMany({ where: { planId: plan.id } });
      const check = validatePlanStructure(all.map(toInput));
      if (!check.valid) throw new OpFailed(ops.length - 1, 'plan', check.issues.map((i) => i.message).join('; '));
    } catch (e) {
      await this.rollBack(auth.userId, before, batchId);
      if (e instanceof OpFailed) {
        throw new BadRequestException(`Nothing was changed. ops[${e.index}] (${e.op}): ${e.message}`);
      }
      throw e;
    }

    return {
      batchId,
      applied: ops.length,
      created: Object.fromEntries([...run.refs.entries()].map(([ref, id]) => [ref, id])),
      plan: await this.outline(plan.id),
    };
  }

  /** Puts the plan back and forgets the batch, or leaves the batch to undo by hand if that fails. */
  private async rollBack(userId: string, before: PlanSnapshot, batchId: string) {
    try {
      await restorePlan(this.prisma, userId, before);
      await this.prisma.batch.delete({ where: { id: batchId } });
    } catch {
      await this.prisma.batch.update({
        where: { id: batchId },
        data: { summary: 'Plan edit failed part way and could not be rolled back automatically: undo this batch to restore the plan' },
      });
    }
  }

  async undo(batch: Batch) {
    const before = batch.undoData as unknown as PlanSnapshot;
    await restorePlan(this.prisma, batch.userId, before);
    await this.prisma.batch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } });
    return { batchId: batch.id, alreadyUndone: false, kind: batch.kind, restored: { plan: true } };
  }

  /** The sections as they stand, so the AI can show the user the result. */
  private async outline(planId: string) {
    const [sections, listings, goals] = await Promise.all([
      this.sections.findAllForPlan(planId),
      this.prisma.listing.findMany({ where: { section: { planId } } }),
      this.prisma.goal.findMany({ where: { section: { planId } } }),
    ]);
    return sections.map((s) => ({
      id: s.id,
      parentId: s.parentId,
      name: s.name,
      type: s.type,
      allocation: s.allocationMode === 'REMAINDER' ? 'remainder' : `${s.percentage.toString()}%`,
      perPayday: Number(s.projectedAmount),
      accountId: s.accountId,
      bills: listings
        .filter((l) => l.sectionId === s.id)
        .map((l) => ({
          id: l.id,
          name: l.name,
          amount: Number(l.amount),
          dueDay: l.dueDay,
          recurrence: l.recurrence,
          dueDate: l.dueDate ? l.dueDate.toISOString().slice(0, 10) : null,
        })),
      goal: goals.filter((g) => g.sectionId === s.id).map((g) => ({ id: g.id, mode: g.mode, targetAmount: Number(g.targetAmount) }))[0] ?? null,
    }));
  }

  // ---------- applying one op ----------

  private async apply(run: Run, op: PlanOp): Promise<void> {
    const { auth } = run;
    const userId = auth.userId;
    const remember = (ref: string | undefined, id: string) => {
      if (ref) run.refs.set(ref, id);
    };

    switch (op.op) {
      case 'rename_plan':
        await this.prisma.plan.update({ where: { id: run.planId }, data: { name: op.name } });
        return;

      case 'add_account': {
        const account = await this.accounts.create({ userId, name: op.name, type: op.type, balance: String(op.startingBalance ?? 0) } as never);
        remember(op.ref, account.id);
        return;
      }
      case 'rename_account': {
        const id = await this.resolve(run, 'account', op.account);
        await this.accounts.update(id, { name: op.name });
        return;
      }
      case 'remove_account': {
        const id = await this.resolve(run, 'account', op.account);
        await this.accounts.remove(id);
        return;
      }

      case 'add_section': {
        const parentId = op.parent ? await this.resolve(run, 'section', op.parent) : null;
        const accountId = op.account ? await this.resolve(run, 'account', op.account) : null;
        if (accountId) await this.assertAccountFits(op.type, accountId);
        const last = await this.prisma.section.aggregate({ where: { planId: run.planId, parentId }, _max: { priorityOrder: true } });
        const created = await this.prisma.section.create({
          data: {
            planId: run.planId,
            parentId,
            name: op.name,
            type: op.type,
            allocationMode: op.remainder ? 'REMAINDER' : 'PERCENTAGE',
            percentage: op.remainder ? '0' : String(op.percentage ?? 0),
            priorityOrder: (last._max.priorityOrder ?? 0) + 1,
            protected: op.protected ?? false,
            accountId,
          },
        });
        remember(op.ref, created.id);
        return;
      }
      case 'update_section': {
        const id = await this.resolve(run, 'section', op.section);
        const current = await this.prisma.section.findUniqueOrThrow({ where: { id } });
        const data: Prisma.SectionUncheckedUpdateInput = {};
        if (op.name !== undefined) data.name = op.name;
        if (op.type !== undefined) data.type = op.type;
        if (op.protected !== undefined) data.protected = op.protected;
        if (op.remainder === true) {
          data.allocationMode = 'REMAINDER';
          data.percentage = '0';
        } else if (op.remainder === false || op.percentage !== undefined) {
          data.allocationMode = 'PERCENTAGE';
          if (op.percentage !== undefined) data.percentage = String(op.percentage);
        }
        if (op.parent !== undefined) data.parentId = op.parent === null ? null : await this.resolve(run, 'section', op.parent);
        if (op.account !== undefined) data.accountId = op.account === null ? null : await this.resolve(run, 'account', op.account);
        const finalAccount = (data.accountId === undefined ? current.accountId : (data.accountId as string | null)) ?? null;
        if (finalAccount) await this.assertAccountFits((data.type as Section['type'] | undefined) ?? current.type, finalAccount);
        await this.prisma.section.update({ where: { id }, data });
        return;
      }
      case 'remove_section': {
        const id = await this.resolve(run, 'section', op.section);
        const goal = await this.prisma.goal.findUnique({ where: { sectionId: id } });
        if (goal) await this.goals.remove(goal.id);
        await this.sections.remove(id);
        return;
      }
      case 'reorder_sections': {
        const ids = await Promise.all(op.sections.map((s) => this.resolve(run, 'section', s)));
        await this.sections.reorder(run.planId, { orderedSectionIds: ids });
        return;
      }

      case 'add_bill': {
        const sectionId = await this.resolve(run, 'section', op.section);
        const bill = await this.listings.create(sectionId, {
          userId,
          name: op.name,
          amount: String(op.amount),
          dueDay: op.dueDay,
          recurrence: op.recurrence,
          dueDate: op.dueDate,
        });
        remember(op.ref, bill.id);
        return;
      }
      case 'update_bill': {
        const id = await this.resolve(run, 'bill', op.bill);
        const sectionId = op.section ? await this.resolve(run, 'section', op.section) : undefined;
        await this.listings.update(id, {
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.amount !== undefined ? { amount: String(op.amount) } : {}),
          ...(op.dueDay !== undefined ? { dueDay: op.dueDay } : {}),
          ...(op.recurrence !== undefined ? { recurrence: op.recurrence } : {}),
          ...(op.dueDate !== undefined ? { dueDate: op.dueDate } : {}),
          ...(sectionId !== undefined ? { sectionId } : {}),
        });
        return;
      }
      case 'remove_bill': {
        const id = await this.resolve(run, 'bill', op.bill);
        await this.listings.remove(id);
        return;
      }

      case 'add_goal': {
        const sectionId = await this.resolve(run, 'section', op.section);
        const goal = await this.goals.create(sectionId, {
          mode: op.mode,
          targetAmount: String(op.targetAmount),
          targetDate: op.targetDate,
          startingAmount: op.startingAmount === undefined ? undefined : String(op.startingAmount),
        } as CreateGoalDto);
        remember(op.ref, goal.id);
        return;
      }
      case 'update_goal': {
        const id = await this.resolveGoal(run, op.goal);
        await this.goals.update(id, {
          ...(op.targetAmount !== undefined ? { targetAmount: String(op.targetAmount) } : {}),
          ...(op.targetDate !== undefined ? { targetDate: op.targetDate } : {}),
          ...(op.startingAmount !== undefined ? { startingAmount: String(op.startingAmount) } : {}),
        });
        return;
      }
      case 'remove_goal': {
        const id = await this.resolveGoal(run, op.goal);
        await this.goals.remove(id);
        return;
      }

      case 'add_income': {
        const accountId = await this.resolve(run, 'account', op.account);
        const income = await this.incomes.create({
          userId,
          amount: String(op.amount),
          source: op.source,
          date: op.date,
          recurring: true,
          frequency: op.frequency,
          accountId,
        } as CreateIncomeDto);
        remember(op.ref, income.id);
        return;
      }
      case 'update_income': {
        const id = await this.resolve(run, 'income', op.income);
        const accountId = op.account ? await this.resolve(run, 'account', op.account) : undefined;
        await this.incomes.update(id, {
          ...(op.source !== undefined ? { source: op.source } : {}),
          ...(op.amount !== undefined ? { amount: String(op.amount) } : {}),
          ...(op.frequency !== undefined ? { frequency: op.frequency } : {}),
          ...(op.nextPayday !== undefined ? { nextRunDate: op.nextPayday } : {}),
          ...(accountId !== undefined ? { accountId } : {}),
        });
        return;
      }
      case 'remove_income': {
        const id = await this.resolve(run, 'income', op.income);
        await this.incomes.remove(id);
        return;
      }
    }
  }

  // ---------- helpers ----------

  /** "$name" from an earlier op, or an id; either way it must be the caller's own. */
  private async resolve(run: Run, kind: 'account' | 'section' | 'bill' | 'income', value: string): Promise<string> {
    const id = value.startsWith('$') ? run.refs.get(value.slice(1)) : value;
    if (!id) throw new BadRequestException(`${value} does not refer to anything an earlier op created`);
    const userId = run.auth.userId;
    const found =
      kind === 'account'
        ? await this.prisma.account.findFirst({ where: { id, userId }, select: { id: true } })
        : kind === 'section'
          ? await this.prisma.section.findFirst({ where: { id, plan: { userId } }, select: { id: true } })
          : kind === 'bill'
            ? await this.prisma.listing.findFirst({ where: { id, userId }, select: { id: true } })
            : await this.prisma.income.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) throw new BadRequestException(`${kind} ${value} was not found`);
    if (kind === 'account' && run.auth.accountIds.length > 0 && !run.auth.accountIds.includes(id)) {
      throw new ForbiddenException('This token is not allowed to use that account');
    }
    return id;
  }

  /** A goal by its id, by "$ref" of an add_goal, or by the id of the section it belongs to. */
  private async resolveGoal(run: Run, value: string): Promise<string> {
    const id = value.startsWith('$') ? run.refs.get(value.slice(1)) : value;
    if (!id) throw new BadRequestException(`${value} does not refer to anything an earlier op created`);
    const userId = run.auth.userId;
    const goal =
      (await this.prisma.goal.findFirst({ where: { id, section: { plan: { userId } } }, select: { id: true } })) ??
      (await this.prisma.goal.findFirst({ where: { sectionId: id, section: { plan: { userId } } }, select: { id: true } }));
    if (!goal) throw new BadRequestException(`goal ${value} was not found`);
    return goal.id;
  }

  private async assertAccountFits(sectionType: Section['type'], accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException(`account ${accountId} does not exist`);
    if (sectionType === 'GOAL') return;
    const expected = sectionType === 'SAVINGS' ? 'SAVINGS' : 'SPENDING';
    if (account.type !== expected) {
      throw new BadRequestException(`A ${sectionType} section can only link to a ${expected} account, but "${account.name}" is a ${account.type} account`);
    }
  }
}

