// Checks an AI's batch of rows against the user's data and works out exactly
// what logging it would do. Pure (no Prisma, no Nest) so the rules are easy to
// test; BatchService loads the data, calls this, and writes the result.

import { randomUUID } from 'node:crypto';
import type { BatchRowDto } from './dto/log-batch.dto.js';

export interface PlannerContext {
  now: Date;
  accounts: Array<{ id: string; name: string }>;
  /** Empty = no limit. A token limited to some accounts may only use those. */
  allowedAccountIds: readonly string[];
  sections: Array<{ id: string; name: string; goal: { id: string; mode: string } | null }>;
  listings: Array<{ id: string; name: string; sectionId: string }>;
  /** Transactions already in the database around the rows' dates, any source. */
  existingTransactions: Array<{ id?: string; accountId: string; date: Date; cents: number; description: string; source?: string }>;
  existingTransfers: Array<{ fromAccountId: string; toAccountId: string; date: Date; cents: number }>;
}

export interface PlannedTransaction {
  id: string;
  accountId: string;
  sectionId: string;
  listingId: string | null;
  cents: number;
  description: string;
  merchant: string | null;
  raw: string | null;
  date: Date;
}

export interface PlannedTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  cents: number;
  note: string;
  goalSectionId: string | null;
  date: Date;
}

export interface Skipped {
  row: number;
  reason: string;
  description: string;
}

/** A new row that looks like something already there, but not exactly. */
export interface PossibleDuplicate {
  row: number;
  description: string;
  existing: { id: string; date: string; description: string; source: string };
}

export interface BatchPlan {
  errors: string[];
  warnings: string[];
  possibleDuplicates: PossibleDuplicate[];
  transactions: PlannedTransaction[];
  transfers: PlannedTransfer[];
  skipped: Skipped[];
  /** Change to each account's balance, in cents. */
  accountDeltas: Map<string, number>;
  /** Change to each goal's saved amount, in cents. */
  goalDeltas: Map<string, number>;
}

const MAX_FUTURE_DAYS = 31;
const MIN_YEAR = 2000;
const MAX_ERRORS_SHOWN = 20;
const NEAR_DAYS = 3;

export const toCents = (amount: number) => Math.round(amount * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

const day = (d: Date) => d.toISOString().slice(0, 10);
const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function planBatch(rows: BatchRowDto[], ctx: PlannerContext): BatchPlan {
  const plan: BatchPlan = {
    errors: [],
    warnings: [],
    possibleDuplicates: [],
    transactions: [],
    transfers: [],
    skipped: [],
    accountDeltas: new Map(),
    goalDeltas: new Map(),
  };

  const accounts = new Map(ctx.accounts.map((a) => [a.id, a]));
  const sections = new Map(ctx.sections.map((s) => [s.id, s]));
  const listings = new Map(ctx.listings.map((l) => [l.id, l]));
  const limited = ctx.allowedAccountIds.length > 0;
  const latest = ctx.now.getTime() + MAX_FUTURE_DAYS * 86_400_000;

  // How many of each kind of row already exist, so a re-imported statement (or a
  // row the user typed in by hand) is skipped. Two identical rows in one batch
  // are two real purchases, so they only count as duplicates up to how many exist.
  const have = new Map<string, number>();
  const bump = (key: string) => have.set(key, (have.get(key) ?? 0) + 1);
  for (const t of ctx.existingTransactions) bump(`t|${t.accountId}|${day(t.date)}|${t.cents}|${norm(t.description)}`);
  for (const t of ctx.existingTransfers) bump(`x|${t.fromAccountId}|${t.toAccountId}|${day(t.date)}|${t.cents}`);
  const seen = new Map<string, number>();

  const fail = (index: number, message: string) => plan.errors.push(`rows[${index}]: ${message}`);
  const name = (id: string) => accounts.get(id)?.name ?? id;

  const checkAccount = (index: number, id: string, label: string): boolean => {
    if (!accounts.has(id)) {
      fail(index, `${label} is not one of your accounts`);
      return false;
    }
    if (limited && !ctx.allowedAccountIds.includes(id)) {
      fail(index, `this token is not allowed to use the account "${name(id)}"`);
      return false;
    }
    return true;
  };

  rows.forEach((row, index) => {
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < MIN_YEAR || date.getTime() > latest) {
      return fail(index, `date ${row.date} is not a sensible date`);
    }
    const cents = toCents(row.amount);
    if (cents === 0) return fail(index, 'amount cannot be 0');
    if (Math.abs(cents) > 1_000_000_000_00) return fail(index, 'amount is too large');
    const description = row.description.trim();
    if (!description) return fail(index, 'description cannot be empty');

    const isTransfer = row.type === 'transfer' || (row.type === undefined && row.toAccountId !== undefined);

    if (isTransfer) {
      if (!row.toAccountId) return fail(index, 'a transfer needs toAccountId');
      if (cents < 0) return fail(index, 'a transfer amount must be positive (it moves from accountId to toAccountId)');
      if (row.accountId === row.toAccountId) return fail(index, 'a transfer needs two different accounts');
      const okFrom = checkAccount(index, row.accountId, 'accountId');
      const okTo = checkAccount(index, row.toAccountId, 'toAccountId');
      if (!okFrom || !okTo) return;

      let goalId: string | null = null;
      if (row.goalSectionId) {
        const section = sections.get(row.goalSectionId);
        if (!section) return fail(index, 'goalSectionId is not one of your sections');
        if (!section.goal || section.goal.mode === 'RESERVE') {
          return fail(index, `"${section.name}" has no goal that money can be paid into`);
        }
        goalId = section.goal.id;
      }

      const key = `x|${row.accountId}|${row.toAccountId}|${day(date)}|${cents}`;
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      if (ordinal < (have.get(key) ?? 0)) {
        return void plan.skipped.push({ row: index, reason: 'duplicate of a transfer already logged', description });
      }

      plan.transfers.push({
        id: randomUUID(),
        fromAccountId: row.accountId,
        toAccountId: row.toAccountId,
        cents,
        note: description,
        goalSectionId: row.goalSectionId ?? null,
        date,
      });
      plan.accountDeltas.set(row.accountId, (plan.accountDeltas.get(row.accountId) ?? 0) - cents);
      plan.accountDeltas.set(row.toAccountId, (plan.accountDeltas.get(row.toAccountId) ?? 0) + cents);
      if (goalId) plan.goalDeltas.set(goalId, (plan.goalDeltas.get(goalId) ?? 0) + cents);
      return;
    }

    if (row.toAccountId) return fail(index, 'toAccountId is only for transfers; set type to "transfer"');
    if (row.goalSectionId) return fail(index, 'goalSectionId is only for transfers');
    if (!checkAccount(index, row.accountId, 'accountId')) return;

    // A bill belongs to one section, so naming the bill is enough.
    let sectionId = row.sectionId;
    if (row.listingId) {
      const listing = listings.get(row.listingId);
      if (!listing) return fail(index, 'listingId is not one of your bills');
      if (sectionId && sectionId !== listing.sectionId) {
        return fail(index, `"${listing.name}" belongs to a different section than the sectionId given`);
      }
      sectionId = listing.sectionId;
    }
    if (!sectionId) return fail(index, 'sectionId is required (or give a listingId, which has one)');
    const section = sections.get(sectionId);
    if (!section) return fail(index, 'sectionId is not one of your sections');

    const key = `t|${row.accountId}|${day(date)}|${cents}|${norm(description)}`;
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    if (ordinal < (have.get(key) ?? 0)) {
      return void plan.skipped.push({ row: index, reason: 'duplicate of a transaction already logged', description });
    }

    plan.transactions.push({
      id: randomUUID(),
      accountId: row.accountId,
      sectionId,
      listingId: row.listingId ?? null,
      cents,
      description,
      merchant: row.merchant?.trim() || null,
      raw: row.raw?.trim() || null,
      date,
    });
    plan.accountDeltas.set(row.accountId, (plan.accountDeltas.get(row.accountId) ?? 0) + cents);
    // A reserve goal watches an account balance and has no running total.
    if (section.goal && section.goal.mode !== 'RESERVE') {
      plan.goalDeltas.set(section.goal.id, (plan.goalDeltas.get(section.goal.id) ?? 0) + cents);
      if (cents < 0) {
        plan.warnings.push(
          `rows[${index}]: "${section.name}" is a goal section, so this ${fromCents(-cents)} purchase lowers that goal's saved amount. File it under a spending section unless the user meant to spend from the goal.`,
        );
      }
    }

    // The same amount on the same account within a few days of something that
    // is already there, but described differently or dated a day apart: most
    // likely the user's own entry of this purchase.
    const near = ctx.existingTransactions.find(
      (e) =>
        e.id !== undefined &&
        e.accountId === row.accountId &&
        e.cents === cents &&
        Math.abs(e.date.getTime() - date.getTime()) <= NEAR_DAYS * 86_400_000 &&
        !plan.possibleDuplicates.some((p) => p.existing.id === e.id),
    );
    if (near) {
      plan.possibleDuplicates.push({
        row: index,
        description,
        existing: { id: near.id!, date: day(near.date), description: near.description, source: near.source ?? 'manual' },
      });
    }
  });

  return plan;
}

/** One readable message for the AI, naming the first problems. */
export function describeErrors(errors: string[]): string {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN).join('; ');
  const more = errors.length > MAX_ERRORS_SHOWN ? `; and ${errors.length - MAX_ERRORS_SHOWN} more` : '';
  return `Nothing was logged. ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${shown}${more}`;
}
