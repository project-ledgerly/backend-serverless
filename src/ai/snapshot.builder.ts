// Turns plain rows into the snapshot an AI reads. Kept free of Prisma and Nest
// so the month maths and the account limit are easy to test.

export interface SnapshotInput {
  now: Date;
  user: { name: string; currency: string };
  accounts: Array<{ id: string; name: string; type: string; balance: number; identifiers?: string[] }>;
  incomes: Array<{
    id: string;
    source: string;
    amount: number;
    recurring: boolean;
    frequency: string | null;
    nextRunDate: Date | null;
    accountId: string;
  }>;
  plan: { id: string; name: string } | null;
  sections: Array<{
    id: string;
    parentId: string | null;
    name: string;
    type: string;
    allocationMode: string;
    percentage: number;
    accountId: string | null;
    protected: boolean;
    /** What this section gets per payday, from the plan's recurring income. */
    projectedAmount: number;
  }>;
  listings: Array<{ id: string; sectionId: string; name: string; amount: number; dueDay: number | null }>;
  goals: Array<{
    id: string;
    sectionId: string;
    mode: string;
    targetAmount: number;
    currentAmount: number;
    startingAmount: number;
    targetDate: Date | null;
  }>;
  /** Every transaction dated in the current month. */
  monthTransactions: Transaction[];
  /** The latest few transactions, any month. */
  recentTransactions: Transaction[];
  /** Empty = no limit. A token limited to some accounts only sees those. */
  allowedAccountIds: readonly string[];
}

export interface Transaction {
  id: string;
  date: Date;
  amount: number;
  description: string;
  accountId: string;
  sectionId: string;
  listingId: string | null;
  merchant?: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Same rule as the app: either text contains the other, ignoring case. */
function namesBill(description: string, billName: string): boolean {
  const d = description.trim().toLowerCase();
  const b = billName.trim().toLowerCase();
  if (!d || !b) return false;
  return d.includes(b) || b.includes(d);
}

export function buildSnapshot(input: SnapshotInput) {
  const { now } = input;
  const limited = input.allowedAccountIds.length > 0;
  const allowed = (accountId: string) => !limited || input.allowedAccountIds.includes(accountId);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const accounts = input.accounts.filter((a) => allowed(a.id));
  const monthTx = input.monthTransactions.filter((t) => allowed(t.accountId));
  const recentTx = input.recentTransactions.filter((t) => allowed(t.accountId));

  const sectionName = new Map(input.sections.map((s) => [s.id, s.name]));
  const listingName = new Map(input.listings.map((l) => [l.id, l.name]));
  const accountName = new Map(input.accounts.map((a) => [a.id, a.name]));

  // Spending is the negative side of a section's transactions, money in the positive side.
  const spentBySection = new Map<string, number>();
  const receivedBySection = new Map<string, number>();
  let spent = 0;
  let received = 0;
  for (const t of monthTx) {
    if (t.amount < 0) {
      spent += -t.amount;
      spentBySection.set(t.sectionId, (spentBySection.get(t.sectionId) ?? 0) + -t.amount);
    } else {
      received += t.amount;
      receivedBySection.set(t.sectionId, (receivedBySection.get(t.sectionId) ?? 0) + t.amount);
    }
  }

  const balanceOf = new Map(input.accounts.map((a) => [a.id, a.balance]));
  const sections = input.sections.map((s) => {
    const spentThisMonth = spentBySection.get(s.id) ?? 0;
    const goal = input.goals.find((g) => g.sectionId === s.id);
    return {
      id: s.id,
      parentId: s.parentId,
      name: s.name,
      type: s.type,
      allocation: s.allocationMode === 'REMAINDER' ? 'remainder' : `${s.percentage}%`,
      percentage: s.percentage,
      accountId: s.accountId,
      accountName: s.accountId ? (accountName.get(s.accountId) ?? null) : null,
      protected: s.protected,
      perPayday: round(s.projectedAmount),
      spentThisMonth: round(spentThisMonth),
      receivedThisMonth: round(receivedBySection.get(s.id) ?? 0),
      bills: input.listings
        .filter((l) => l.sectionId === s.id)
        .map((l) => {
          // Paid by an expense linked to the bill, or by an unlinked one in the
          // same section whose description names it (how the app decides too).
          const paid = monthTx
            .filter(
              (t) =>
                t.amount < 0 &&
                (t.listingId === l.id || (t.listingId === null && t.sectionId === l.sectionId && namesBill(t.description, l.name))),
            )
            .reduce((sum, t) => sum - t.amount, 0);
          return {
            id: l.id,
            name: l.name,
            amount: round(l.amount),
            dueDay: l.dueDay,
            paidThisMonth: paid > 0,
            paidAmount: round(paid),
          };
        }),
      goal: goal
        ? {
            id: goal.id,
            mode: goal.mode,
            targetAmount: round(goal.targetAmount),
            currentAmount: round(goal.currentAmount),
            startingAmount: round(goal.startingAmount),
            targetDate: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
            // A reserve is a floor on an account's balance, not an amount saved up.
            ...(goal.mode === 'RESERVE' && s.accountId
              ? { accountBalance: round(balanceOf.get(s.accountId) ?? 0) }
              : {
                  percentComplete:
                    goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0,
                }),
          }
        : null,
    };
  });

  return {
    asOf: now.toISOString(),
    user: input.user,
    currency: input.user.currency,
    // Said out loud so the AI doesn't assume it can see everything.
    limitedToAccounts: limited ? accounts.map((a) => a.name) : null,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: round(a.balance),
      // How the bank prints this account (number or last digits), to recognise a statement.
      identifiers: a.identifiers ?? [],
    })),
    incomes: input.incomes
      .filter((i) => allowed(i.accountId))
      .map((i) => ({
        id: i.id,
        source: i.source,
        amount: round(i.amount),
        recurring: i.recurring,
        frequency: i.frequency,
        nextPayday: i.nextRunDate ? i.nextRunDate.toISOString().slice(0, 10) : null,
        accountId: i.accountId,
      })),
    plan: input.plan ? { id: input.plan.id, name: input.plan.name, sections } : null,
    thisMonth: {
      from: monthStart.toISOString().slice(0, 10),
      to: new Date(nextMonthStart.getTime() - 1).toISOString().slice(0, 10),
      spent: round(spent),
      received: round(received),
    },
    recentTransactions: recentTx.map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      amount: round(t.amount),
      description: t.description,
      merchant: t.merchant ?? null,
      account: accountName.get(t.accountId) ?? null,
      section: sectionName.get(t.sectionId) ?? null,
      bill: t.listingId ? (listingName.get(t.listingId) ?? null) : null,
    })),
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
