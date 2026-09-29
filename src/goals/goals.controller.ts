import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GoalsService } from './goals.service.js';
import { GoalSchedulerService } from './goal-scheduler.service.js';
import { CreateGoalDto } from './dto/create-goal.dto.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';

@ApiTags('goals')
@Controller()
export class GoalsController {
  constructor(
    private readonly goalsService: GoalsService,
    private readonly goalSchedulerService: GoalSchedulerService,
  ) {}

  // Lazy monthly rollover for MONTHLY_RECURRING goals — call on app open,
  // same pattern as /incomes/catch-up. Archives any elapsed month(s) into a
  // GoalMonthSnapshot and resets currentAmount for the new month.
  @Post('goals/catch-up')
  catchUp(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.goalSchedulerService.catchUp(userId);
  }

  @Post('sections/:sectionId/goal')
  create(@Param('sectionId') sectionId: string, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(sectionId, dto);
  }

  @Get('sections/:sectionId/goal')
  findForSection(@Param('sectionId') sectionId: string) {
    return this.goalsService.findForSection(sectionId);
  }

  @Patch('goals/:goalId')
  update(@Param('goalId') goalId: string, @Body() dto: UpdateGoalDto) {
    return this.goalsService.update(goalId, dto);
  }

  @Delete('goals/:goalId')
  remove(@Param('goalId') goalId: string) {
    return this.goalsService.remove(goalId);
  }
}
