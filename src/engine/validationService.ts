import { Decimal } from "decimal.js";
import type { AllocationResult, SectionInput, ValidationIssue, ValidationResult } from "./types.js";

function checkFixedCommitmentsUnderIncome(
  sections: SectionInput[],
  result: AllocationResult,
  issues: ValidationIssue[],
) {
  const fixedTypes = new Set(["ESSENTIAL", "SAVINGS", "GOAL"]);
  const topLevelFixed = sections.filter((s) => s.parentId === null && fixedTypes.has(s.type));
  const total = topLevelFixed.reduce(
    (sum, s) => sum.plus(result.amounts.get(s.id) ?? 0),
    new Decimal(0),
  );
  const flexible = sections.filter((s) => s.parentId === null && s.type === "FLEXIBLE");
  const flexibleTotal = flexible.reduce(
    (sum, s) => sum.plus(result.amounts.get(s.id) ?? 0),
    new Decimal(0),
  );
  if (flexibleTotal.isNegative()) {
    issues.push({
      rule: 1,
      message: `essentials + savings + goals (${total}) exceed income; flexible would go negative`,
    });
  }
}

function checkEssentialsSavingsGoalsPercentage(sections: SectionInput[], issues: ValidationIssue[]) {
  // Linear in income: essentials+savings+goals <= income holds for every
  // income amount iff their top-level percentages sum to <= 100. Lets this
  // run at save time, before any income event exists.
  const fixedTypes = new Set(["ESSENTIAL", "SAVINGS", "GOAL"]);
  const topLevelFixed = sections.filter(
    (s) => s.parentId === null && fixedTypes.has(s.type) && s.allocationMode === "PERCENTAGE",
  );
  const total = topLevelFixed.reduce((sum, s) => sum.plus(s.percentage), new Decimal(0));
  if (total.greaterThan(100)) {
    issues.push({
      rule: 1,
      message: `essentials + savings + goals percentages sum to ${total}%, exceeds 100% of income`,
    });
  }
}

function checkChildPercentagesSumToParent(sections: SectionInput[], issues: ValidationIssue[]) {
  const byParent = new Map<string, SectionInput[]>();
  for (const section of sections) {
    if (section.parentId === null) continue;
    const siblings = byParent.get(section.parentId) ?? [];
    siblings.push(section);
    byParent.set(section.parentId, siblings);
  }
  for (const [parentId, siblings] of byParent) {
    const percentageSum = siblings
      .filter((s) => s.allocationMode === "PERCENTAGE")
      .reduce((sum, s) => sum.plus(s.percentage), new Decimal(0));
    if (percentageSum.greaterThan(100)) {
      issues.push({
        rule: 2,
        message: `sum(child.percentage) under ${parentId} is ${percentageSum}, exceeds 100`,
      });
    }
  }
}

function checkSingleRemainderPerLevel(sections: SectionInput[], issues: ValidationIssue[]) {
  const byParent = new Map<string | null, SectionInput[]>();
  for (const section of sections) {
    const siblings = byParent.get(section.parentId) ?? [];
    siblings.push(section);
    byParent.set(section.parentId, siblings);
  }
  for (const [parentId, siblings] of byParent) {
    const remainderCount = siblings.filter((s) => s.allocationMode === "REMAINDER").length;
    if (remainderCount > 1) {
      issues.push({
        rule: 3,
        message: `sibling group under ${parentId ?? "top level"} has ${remainderCount} remainder sections, expected at most 1`,
      });
    }
  }
}

export function validatePlan(sections: SectionInput[], result: AllocationResult): ValidationResult {
  const issues: ValidationIssue[] = [];
  checkFixedCommitmentsUnderIncome(sections, result, issues);
  checkChildPercentagesSumToParent(sections, issues);
  checkSingleRemainderPerLevel(sections, issues);
  return { valid: issues.length === 0, issues };
}

/**
 * Rules 1 and 2, checkable from structure alone (percentages), no income
 * event required — run this at section create/update ("Plan save").
 * Rule 3 is enforced at the DB level by a partial unique index, not here.
 */
export function validatePlanStructure(sections: SectionInput[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  checkEssentialsSavingsGoalsPercentage(sections, issues);
  checkChildPercentagesSumToParent(sections, issues);
  return { valid: issues.length === 0, issues };
}

/**
 * Rule 6: a percentage edit only needs to re-validate the edited section's
 * own sibling group — its parent's children (rule 2), or the top-level
 * group (rule 1) if it has no parent — not every other branch of the plan.
 * `siblings` must all share the same parentId (the caller queries by it).
 */
export function validateSiblingGroup(siblings: SectionInput[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parentId = siblings[0]?.parentId ?? null;
  if (parentId === null) {
    checkEssentialsSavingsGoalsPercentage(siblings, issues);
  } else {
    checkChildPercentagesSumToParent(siblings, issues);
  }
  return { valid: issues.length === 0, issues };
}
