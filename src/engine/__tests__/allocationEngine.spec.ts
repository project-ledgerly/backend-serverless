import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { allocate } from "../allocationEngine.js";
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

function amountOf(result: ReturnType<typeof allocate>, id: string): number {
  return result.amounts.get(id)!.toNumber();
}

describe("allocate", () => {
  it("funds percentage sections off income, remainder last", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 1 }),
      section({ id: "savings", type: "SAVINGS", allocationMode: "PERCENTAGE", percentage: 20, priorityOrder: 2 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", percentage: 0, priorityOrder: 3 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "essential")).toBe(500);
    expect(amountOf(result, "savings")).toBe(200);
    expect(amountOf(result, "flexible")).toBe(300);
    expect(result.order).toEqual(["essential", "savings", "flexible"]);
  });

  it("computes child amounts relative to parent's computed amount, not total income", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 1 }),
      section({ id: "rent", parentId: "essential", allocationMode: "PERCENTAGE", percentage: 80, priorityOrder: 1 }),
      section({ id: "groceries", parentId: "essential", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "essential")).toBe(500);
    expect(amountOf(result, "rent")).toBe(400); // 80% of 500, not 80% of 1000
    expect(amountOf(result, "groceries")).toBe(100); // remainder of essential's 500
  });

  it("lets flexible go negative when fixed commitments exceed income (validation catches it separately)", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 110, priorityOrder: 1 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "flexible")).toBe(-100);
  });

  it("handles zero income: every section resolves to zero", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 50, priorityOrder: 1 }),
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 2 }),
    ];

    const result = allocate(sections, 0);

    expect(amountOf(result, "essential")).toBe(0);
    expect(amountOf(result, "flexible")).toBe(0);
  });

  it("handles a sibling group with no remainder section: last percentage sibling just leaves money unallocated", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 30, priorityOrder: 1 }),
      section({ id: "savings", type: "SAVINGS", allocationMode: "PERCENTAGE", percentage: 20, priorityOrder: 2 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "essential")).toBe(300);
    expect(amountOf(result, "savings")).toBe(200);
    // no section claims the remaining 500 — engine doesn't invent a remainder sibling
  });

  it("handles a leaf section with no children: recursion just stops", () => {
    const sections: SectionInput[] = [
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "REMAINDER", priorityOrder: 1 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "essential")).toBe(1000);
    expect(result.order).toEqual(["essential"]);
  });

  it("still resolves remainder last even if its priorityOrder is lower than a percentage sibling's", () => {
    const sections: SectionInput[] = [
      // Remainder given priorityOrder 1 (would sort first by number alone) —
      // engine must still fund it last, or the two allocations overlap.
      section({ id: "flexible", type: "FLEXIBLE", allocationMode: "REMAINDER", priorityOrder: 1 }),
      section({ id: "essential", type: "ESSENTIAL", allocationMode: "PERCENTAGE", percentage: 60, priorityOrder: 2 }),
    ];

    const result = allocate(sections, 1000);

    expect(amountOf(result, "essential")).toBe(600);
    expect(amountOf(result, "flexible")).toBe(400);
    expect(result.order).toEqual(["essential", "flexible"]);
  });

  it("keeps precision across many fractional-percentage sections (no float drift)", () => {
    const sections: SectionInput[] = [
      section({ id: "a", allocationMode: "PERCENTAGE", percentage: "33.33", priorityOrder: 1 }),
      section({ id: "b", allocationMode: "PERCENTAGE", percentage: "33.33", priorityOrder: 2 }),
      section({ id: "c", allocationMode: "REMAINDER", priorityOrder: 3 }),
    ];

    const result = allocate(sections, "10.10");

    // 10.10 * 33.33 / 100 = 3.36633 exactly, twice, then remainder
    expect(result.amounts.get("a")!.toString()).toBe("3.36633");
    expect(result.amounts.get("b")!.toString()).toBe("3.36633");
    expect(result.amounts.get("c")!.toString()).toBe("3.36734");
  });
});

describe('allocate with a BILLS section', () => {
  const section = (id: string, type: SectionInput['type'], percentage: number, mode: SectionInput['allocationMode'] = 'PERCENTAGE', priorityOrder = 1): SectionInput => ({
    id,
    parentId: null,
    name: id,
    type,
    allocationMode: mode,
    percentage,
    priorityOrder,
    protected: false,
  });

  it('gives bills their total and splits the rest by percentage', () => {
    const result = allocate(
      [section('bills', 'BILLS', 0), section('ess', 'ESSENTIAL', 40, 'PERCENTAGE', 2), section('save', 'SAVINGS', 25, 'PERCENTAGE', 3), section('flex', 'FLEXIBLE', 0, 'REMAINDER', 4)],
      185000,
      new Map([['bills', new Decimal(109200)]]),
    );
    expect(result.amounts.get('bills')!.toNumber()).toBe(109200);
    expect(result.amounts.get('ess')!.toNumber()).toBe(30320); // 40% of 75,800
    expect(result.amounts.get('save')!.toNumber()).toBe(18950); // 25% of 75,800
    expect(result.amounts.get('flex')!.toNumber()).toBe(26530); // what is left of 75,800
  });

  it('is unchanged when there is no BILLS section', () => {
    const result = allocate([section('ess', 'ESSENTIAL', 50), section('flex', 'FLEXIBLE', 0, 'REMAINDER', 2)], 1000);
    expect(result.amounts.get('ess')!.toNumber()).toBe(500);
    expect(result.amounts.get('flex')!.toNumber()).toBe(500);
  });
});
