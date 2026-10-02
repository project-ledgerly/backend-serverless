import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { GoalsModule } from '../goals/goals.module.js';
import { IncomeModule } from '../income/income.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { SectionsModule } from '../sections/sections.module.js';
import { AiController } from './ai.controller.js';
import { AccountLinkService } from './account-link.service.js';
import { BatchService } from './batch.service.js';
import { IncomeRecordService } from './income-record.service.js';
import { PlanEditService } from './plan-edit.service.js';
import { RecordsService } from './records.service.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  imports: [SectionsModule, AccountsModule, GoalsModule, IncomeModule, ListingsModule],
  controllers: [AiController],
  providers: [SnapshotService, BatchService, AccountLinkService, RecordsService, PlanEditService, IncomeRecordService],
})
export class AiModule {}
