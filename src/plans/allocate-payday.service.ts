import { Injectable } from '@nestjs/common';
import { allocate } from '../engine/allocationEngine.js';
import { validatePlan } from '../engine/validationService.js';
import type { AllocationResult, ValidationResult } from '../engine/types.js';
import { PlanRepository } from './plan.repository.js';
import { TransactionsService } from '../transactions/transactions.service.js';

export type AllocatePaydayResult =
  | { ok: true; result: AllocationResult }
  | { ok: false; validation: ValidationResult };

@Injectable()
export class AllocatePaydayService {
  constructor(
    private readonly planRepository: PlanRepository,
    private readonly transactionsService: TransactionsService,
  ) {}

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
    await this.creditLinkedAccounts(planId, incomeId, result);
    return { ok: true, result };
  }

  /**
   * SectionAllocation only records the computed dollar amount — it never
   * moved real money. Income already landed in income.accountId when it was
   * logged; a section with its own linked Account (a savings pot, say) needs
   * its share physically transferred there, not conjured — debit the income
   * account, credit the section's account, both tagged to that section. A
   * section with no linked Account needs nothing: its share was already
   * sitting in the income account, this is just the paper split.
   */
  private async creditLinkedAccounts(planId: string, incomeId: string, result: AllocationResult) {
    const accountMap = await this.planRepository.loadSectionAccountMap(planId);
    if (accountMap.size === 0) return;
    const { userId, accountId: incomeAccountId } = await this.planRepository.getIncomeUserAndAccount(incomeId);

    for (const [sectionId, amount] of result.amounts) {
      const accountId = accountMap.get(sectionId);
      if (!accountId || accountId === incomeAccountId || amount.isZero()) continue;

      await this.planRepository.recordTransferOutLeg(
        userId,
        incomeAccountId,
        sectionId,
        amount.negated().toString(),
        'Payday allocation (transfer out)',
      );
      await this.transactionsService.create({
        userId,
        accountId,
        sectionId,
        amount: amount.toString(),
        description: 'Payday allocation',
        date: new Date().toISOString(),
        source: 'allocation',
        confirmed: true,
      });
    }
  }
}
