import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller.js';
import { AllocatePaydayService } from './allocate-payday.service.js';
import { PlanRepository } from './plan.repository.js';
import { PlansService } from './plans.service.js';
import { TransactionsModule } from '../transactions/transactions.module.js';

@Module({
  imports: [TransactionsModule],
  controllers: [PlansController],
  providers: [AllocatePaydayService, PlanRepository, PlansService],
})
export class PlansModule {}
