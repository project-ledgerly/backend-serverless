import { Module } from '@nestjs/common';
import { IncomeController } from './income.controller.js';
import { IncomeService } from './income.service.js';
import { IncomeSchedulerService } from './income-scheduler.service.js';

@Module({
  controllers: [IncomeController],
  providers: [IncomeService, IncomeSchedulerService],
  exports: [IncomeService],
})
export class IncomeModule {}
