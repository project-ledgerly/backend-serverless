import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllocatePaydayService } from './allocate-payday.service.js';
import { AllocatePaydayDto } from './dto/allocate-payday.dto.js';
import { PlansService } from './plans.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly allocatePaydayService: AllocatePaydayService,
  ) {}

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Get()
  findAllForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.plansService.findAllForUser(userId);
  }

  @Get(':planId')
  findOne(@Param('planId') planId: string) {
    return this.plansService.findOne(planId);
  }

  @Patch(':planId')
  update(@Param('planId') planId: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(planId, dto);
  }

  @Delete(':planId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('planId') planId: string) {
    return this.plansService.remove(planId);
  }

  @Post(':planId/allocate')
  @ApiOkResponse({ description: 'Computed and persisted allocation amounts, keyed by section id.' })
  async allocate(@Param('planId') planId: string, @Body() dto: AllocatePaydayDto) {
    const outcome = await this.allocatePaydayService.run(planId, dto.incomeId, dto.incomeAmount);

    if (!outcome.ok) {
      throw new BadRequestException({ issues: outcome.validation.issues });
    }

    return {
      amounts: Object.fromEntries(
        Array.from(outcome.result.amounts.entries()).map(([sectionId, amount]) => [sectionId, amount.toString()]),
      ),
      order: outcome.result.order,
    };
  }
}
