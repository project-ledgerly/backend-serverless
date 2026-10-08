import { Decimal } from "decimal.js";
import type { AllocationResult, SectionInput } from "./types.js";

function computeAmount(
  section: SectionInput,
  parentAmount: Decimal,
  siblingAmounts: Decimal[],
): Decimal {
  if (section.allocationMode === "REMAINDER") {
    const fundedSoFar = siblingAmounts.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
    return parentAmount.minus(fundedSoFar);
  }
  return parentAmount.times(section.percentage).dividedBy(100);
}

/**
 * Walks a plan's sections in priority order and computes each one's amount.
 * A remainder-mode section resolves last within its sibling group, after
 * every percentage-mode sibling ahead of it is funded.
 */
export function allocate(
  sections: SectionInput[],
  income: Decimal.Value,
  // A BILLS section is the total of its bills due this pay period, not a percentage; the other
  // sections in its group divide what is left after it.
  billsTotals: Map<string, Decimal> = new Map(),
): AllocationResult {
  const amounts = new Map<string, Decimal>();
  const order: string[] = [];

  const byParent = new Map<string | null, SectionInput[]>();
  for (const section of sections) {
    const siblings = byParent.get(section.parentId) ?? [];
    siblings.push(section);
    byParent.set(section.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    // Remainder always resolves last within its group, regardless of its
    // stored priorityOrder — trusting that value blindly let a remainder
    // section end up funded against zero "funded so far" when reordered
    // ahead of a percentage sibling, double-allocating income.
    siblings.sort((a, b) => {
      if (a.allocationMode !== b.allocationMode) {
        return a.allocationMode === "REMAINDER" ? 1 : -1;
      }
      return a.priorityOrder - b.priorityOrder;
    });
  }

  function fundLevel(parentId: string | null, parentAmount: Decimal) {
    const all = byParent.get(parentId) ?? [];
    let base = parentAmount;
    for (const section of all.filter((s) => s.type === "BILLS")) {
      const amount = billsTotals.get(section.id) ?? new Decimal(0);
      amounts.set(section.id, amount);
      order.push(section.id);
      base = base.minus(amount);
      fundLevel(section.id, amount);
    }
    const siblings = all.filter((s) => s.type !== "BILLS");
    const funded: Decimal[] = [];
    for (const section of siblings) {
      const amount = computeAmount(section, base, funded);
      amounts.set(section.id, amount);
      order.push(section.id);
      funded.push(amount);
      fundLevel(section.id, amount);
    }
  }

  fundLevel(null, new Decimal(income));

  return { amounts, order };
}
