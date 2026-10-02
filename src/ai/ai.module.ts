import { Module } from '@nestjs/common';
import { SectionsModule } from '../sections/sections.module.js';
import { AiController } from './ai.controller.js';
import { BatchService } from './batch.service.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  imports: [SectionsModule],
  controllers: [AiController],
  providers: [SnapshotService, BatchService],
})
export class AiModule {}
