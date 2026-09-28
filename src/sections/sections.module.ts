import { Module } from '@nestjs/common';
import { SectionsController } from './sections.controller.js';
import { SectionsService } from './sections.service.js';

@Module({
  controllers: [SectionsController],
  providers: [SectionsService],
})
export class SectionsModule {}
