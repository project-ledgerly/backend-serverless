import { Decimal } from "decimal.js";
import type { GoalInput } from "./types.js";

const AVG_DAYS_PER_MONTH = 30.44;

function monthsRemaining(targetDate: Date, now: Date): number {
  const diffMs = targetDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  // Past-due or due-this-month goals still need a contribution figure, so
  // floor at 1 month rather than dividing by zero or going negative.
  return Math.max(1, Math.ceil(diffDays / AVG_DAYS_PER_MONTH));
}

/**
 * (target - current) / monthsRemaining, per spec. Caller decides whether to
 * apply this — a Goal with autoCalculated = false has been manually
 * overridden and should not be recomputed.
 */
export function monthlyContribution(goal: GoalInput, now: Date = new Date()): Decimal {
  const remaining = new Decimal(goal.targetAmount).minus(goal.currentAmount);
  const months = monthsRemaining(goal.targetDate, now);
  return remaining.dividedBy(months);
}
