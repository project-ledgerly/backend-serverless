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
export function allocate(sections: SectionInput[], income: Decimal.Value): AllocationResult {
  const amounts = new Map<string, Decimal>();
  const order: string[] = [];

  const byParent = new Map<string | null, SectionInput[]>();
  for (const section of sections) {
    const siblings = byParent.get(section.parentId) ?? [];
    siblings.push(section);
    byParent.set(section.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.priorityOrder - b.priorityOrder);
  }

  function fundLevel(parentId: string | null, parentAmount: Decimal) {
    const siblings = byParent.get(parentId) ?? [];
    const funded: Decimal[] = [];
    for (const section of siblings) {
      const amount = computeAmount(section, parentAmount, funded);
      amounts.set(section.id, amount);
      order.push(section.id);
      funded.push(amount);
      fundLevel(section.id, amount);
    }
  }

  fundLevel(null, new Decimal(income));

  return { amounts, order };
}
