import { describe, expect, it } from "vitest";
import { monthlyContribution } from "../sinkingFundCalculator.js";
import type { GoalInput } from "../types.js";

function goal(overrides: Partial<GoalInput>): GoalInput {
  return {
    id: "goal-1",
    sectionId: "section-1",
    targetAmount: 1200,
    currentAmount: 0,
    targetDate: new Date("2027-09-28"),
    autoCalculated: true,
    ...overrides,
  };
}

describe("monthlyContribution", () => {
  it("splits remaining amount evenly across months remaining", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 1200, currentAmount: 0, targetDate: new Date("2027-09-28") });

    const result = monthlyContribution(g, now);

    // ~12 months out; average-month approximation lands close to 100/mo
    expect(result.toNumber()).toBeCloseTo(100, 0);
  });

  it("subtracts current progress from the target before dividing", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 1200, currentAmount: 600, targetDate: new Date("2027-09-28") });

    const result = monthlyContribution(g, now);

    expect(result.toNumber()).toBeCloseTo(50, 0);
  });

  it("floors at 1 month for a target date that has already passed", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 500, currentAmount: 0, targetDate: new Date("2026-01-01") });

    const result = monthlyContribution(g, now);

    expect(result.toNumber()).toBe(500);
  });

  it("floors at 1 month for a target date due this month", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 300, currentAmount: 0, targetDate: new Date("2026-09-29") });

    const result = monthlyContribution(g, now);

    expect(result.toNumber()).toBe(300);
  });

  it("returns zero when current amount already meets the target", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 500, currentAmount: 500, targetDate: new Date("2027-09-28") });

    const result = monthlyContribution(g, now);

    expect(result.toNumber()).toBe(0);
  });

  it("can go negative when current amount overshoots the target", () => {
    const now = new Date("2026-09-28");
    const g = goal({ targetAmount: 500, currentAmount: 700, targetDate: new Date("2027-09-28") });

    const result = monthlyContribution(g, now);

    expect(result.toNumber()).toBeLessThan(0);
  });
});
