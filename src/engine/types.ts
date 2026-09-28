import type { Decimal } from "decimal.js";

export type SectionType = "ESSENTIAL" | "SAVINGS" | "GOAL" | "FLEXIBLE";
export type AllocationMode = "PERCENTAGE" | "REMAINDER";

export interface SectionInput {
  id: string;
  parentId: string | null;
  name: string;
  type: SectionType;
  allocationMode: AllocationMode;
  percentage: Decimal.Value; // relative to parent's computed amount, 0-100
  priorityOrder: number;
  protected: boolean;
}

export interface AllocationResult {
  amounts: Map<string, Decimal>; // sectionId -> computed amount
  order: string[]; // sectionId, in the order they were funded
}

export interface ValidationIssue {
  rule: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface GoalInput {
  id: string;
  sectionId: string;
  targetAmount: Decimal.Value;
  currentAmount: Decimal.Value;
  targetDate: Date;
  autoCalculated: boolean;
}
