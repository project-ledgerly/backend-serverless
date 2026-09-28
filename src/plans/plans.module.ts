import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller.js';
import { AllocatePaydayService } from './allocate-payday.service.js';
import { PlanRepository } from './plan.repository.js';

@Module({
  controllers: [PlansController],
  providers: [AllocatePaydayService, PlanRepository],
})
export class PlansModule {}
