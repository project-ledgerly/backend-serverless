import { Module } from '@nestjs/common';
import { SectionsModule } from '../sections/sections.module.js';
import { AiController } from './ai.controller.js';
import { AccountLinkService } from './account-link.service.js';
import { BatchService } from './batch.service.js';
import { RecordsService } from './records.service.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  imports: [SectionsModule],
  controllers: [AiController],
  providers: [SnapshotService, BatchService, AccountLinkService, RecordsService],
})
export class AiModule {}
