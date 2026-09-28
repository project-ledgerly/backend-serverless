import { describe, expect, it } from "vitest";
import { allocate } from "../allocationEngine.js";
import { validatePlan } from "../validationService.js";
import type { SectionInput } from "../types.js";

function section(overrides: Partial<SectionInput> & Pick<SectionInput, "id">): SectionInput {
  return {
    parentId: null,
    name: overrides.id,
    type: "FLEXIBLE",
    allocationMode: "PERCENTAGE",
    percentage: 0,
    priorityOrder: 0,
    protected: false,
    ...overrides,
  };
}

describe("validatePlan", () => {
  it("passes a valid plan with no issues", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 1 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];
    const result = allocate(sections, 1000);

    expect(validatePlan(sections, result).valid).toBe(true);
  });

  it("rule 1: blocks when fixed commitments exceed income", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 110, priorityOrder: 1 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];
    const result = allocate(sections, 1000);

    const validation = validatePlan(sections, result);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ rule: 1 }));
  });

  it("rule 2: blocks when child percentages exceed 100 within a parent", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 1 }),
      section({ id: "rent", parentId: "essential", allocationMode: "PERCENTAGE", percentage: 70, priorityOrder: 1 }),
      section({ id: "utilities", parentId: "essential", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 2 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];
    const result = allocate(sections, 1000);

    const validation = validatePlan(sections, result);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ rule: 2 }));
  });

  it("rule 3: blocks when a sibling group has more than one remainder section", () => {
    const sections: SectionInput[] = [
      section({ id: "flex1", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 1 }),
      section({ id: "flex2", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];
    const result = allocate(sections, 1000);

    const validation = validatePlan(sections, result);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ rule: 3 }));
  });
});
