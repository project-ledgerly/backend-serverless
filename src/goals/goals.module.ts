import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { GoalSchedulerService } from './goal-scheduler.service.js';

@Module({
  controllers: [GoalsController],
  providers: [GoalsService, GoalSchedulerService],
})
export class GoalsModule {}
