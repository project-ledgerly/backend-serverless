import { Module } from '@nestjs/common';
import { IncomeController } from './income.controller.js';
import { IncomeService } from './income.service.js';

@Module({
  controllers: [IncomeController],
  providers: [IncomeService],
})
export class IncomeModule {}
