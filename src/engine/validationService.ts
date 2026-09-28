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
