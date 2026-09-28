import { Injectable } from '@nestjs/common';
import { allocate } from '../engine/allocationEngine.js';
import { validatePlan } from '../engine/validationService.js';
import type { AllocationResult, ValidationResult } from '../engine/types.js';
import { PlanRepository } from './plan.repository.js';

export type AllocatePaydayResult =
  | { ok: true; result: AllocationResult }
  | { ok: false; validation: ValidationResult };

@Injectable()
export class AllocatePaydayService {
  constructor(private readonly planRepository: PlanRepository) {}

  /**
   * The payday-allocation sequence diagram from the spec: load sections,
   * run the engine, validate the full pass, persist only if valid.
   */
  async run(planId: string, incomeId: string, incomeAmount: string): Promise<AllocatePaydayResult> {
    const sections = await this.planRepository.loadPlanSections(planId);
    const result = allocate(sections, incomeAmount);
    const validation = validatePlan(sections, result);

    if (!validation.valid) {
      return { ok: false, validation };
    }

    await this.planRepository.persistAllocation(incomeId, result);
    return { ok: true, result };
  }
}
