import { Module } from '@nestjs/common';
import { SectionsModule } from '../sections/sections.module.js';
import { AiController } from './ai.controller.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  imports: [SectionsModule],
  controllers: [AiController],
  providers: [SnapshotService],
})
export class AiModule {}
